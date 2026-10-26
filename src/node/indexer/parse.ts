import { parse as parseJs } from 'acorn';
import { transformSync } from 'esbuild';
import { isStoryExport, storyNameFromExport, titleFromPath, toComponentId, toStoryId } from '../../shared/ids';

/** One story as known statically, before the file is compiled. */
export interface IndexedStory {
  exportName: string;
  id: string;
  name: string;
  tags: string[];
  hasPlay: boolean;
}

/** What static analysis learns about a story file. */
export interface ParsedStoryFile {
  title: string;
  componentId: string;
  /** Local name and import source of `meta.component`, for prop-type inference. */
  component?: { localName: string; source?: string; importedName?: string };
  stories: IndexedStory[];
  /** Module specifiers mocked anywhere in the file (meta or stories). */
  mockSpecifiers: string[];
  tags: string[];
  /** Imports `@storybook/*` — a Storybook story, not ours. */
  isStorybook: boolean;
  warnings: string[];
}

// Minimal ESTree shapes; acorn's types are deliberately loose here.
interface Node {
  type: string;
  [key: string]: unknown;
}

function loaderFor(file: string): 'tsx' | 'ts' | 'jsx' | 'js' {
  if (/\.tsx$/.test(file)) return 'tsx';
  if (/\.[cm]?ts$/.test(file)) return 'ts';
  if (/\.jsx$/.test(file)) return 'jsx';
  return 'jsx';
}

function stringValue(node: Node | undefined | null): string | undefined {
  if (!node) return undefined;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && (node.expressions as Node[]).length === 0) {
    const quasi = (node.quasis as Node[])[0];
    return (quasi?.value as { cooked?: string } | undefined)?.cooked ?? undefined;
  }
  return undefined;
}

function keyName(property: Node): string | undefined {
  const key = property.key as Node;
  if (property.computed) return stringValue(key);
  if (key.type === 'Identifier') return key.name as string;
  return stringValue(key);
}

/**
 * Static model of one module: top-level `const` initialisers, so `export default meta` and
 * `mocks: sharedMocks` can be followed one level.
 */
class ModuleScope {
  readonly consts = new Map<string, Node>();
  readonly imports = new Map<string, { source: string; importedName: string }>();

  constructor(program: Node) {
    for (const statement of program.body as Node[]) {
      const declaration = statement.type === 'ExportNamedDeclaration' ? (statement.declaration as Node | null) : statement;
      if (declaration?.type === 'VariableDeclaration') {
        for (const declarator of declaration.declarations as Node[]) {
          const id = declarator.id as Node;
          if (id.type === 'Identifier' && declarator.init) this.consts.set(id.name as string, declarator.init as Node);
        }
      }
      if (statement.type === 'ImportDeclaration') {
        const source = (statement.source as Node).value as string;
        for (const specifier of statement.specifiers as Node[]) {
          const local = (specifier.local as Node).name as string;
          const importedName =
            specifier.type === 'ImportDefaultSpecifier'
              ? 'default'
              : specifier.type === 'ImportNamespaceSpecifier'
                ? '*'
                : (((specifier.imported as Node).name ?? (specifier.imported as Node).value) as string);
          this.imports.set(local, { source, importedName });
        }
      }
    }
  }

  /** Follows identifiers, call wrappers (`defineMeta({...})`) and arrow bodies to an object. */
  resolveObject(node: Node | undefined | null, depth = 0): Node | undefined {
    if (!node || depth > 5) return undefined;
    switch (node.type) {
      case 'ObjectExpression':
        return node;
      case 'Identifier':
        return this.resolveObject(this.consts.get(node.name as string), depth + 1);
      case 'CallExpression': {
        const first = (node.arguments as Node[])[0];
        return this.resolveObject(first, depth + 1);
      }
      case 'ArrowFunctionExpression':
      case 'FunctionExpression': {
        const body = node.body as Node;
        if (body.type !== 'BlockStatement') return this.resolveObject(body, depth + 1);
        const ret = (body.body as Node[]).find((s) => s.type === 'ReturnStatement');
        return this.resolveObject(ret?.argument as Node | undefined, depth + 1);
      }
      case 'ParenthesizedExpression':
      case 'TSAsExpression':
      case 'TSSatisfiesExpression':
        return this.resolveObject(node.expression as Node, depth + 1);
      default:
        return undefined;
    }
  }

  /** Property value of an object literal, including spread sources (later wins). */
  property(object: Node | undefined, name: string): Node | undefined {
    if (!object) return undefined;
    let found: Node | undefined;
    for (const property of object.properties as Node[]) {
      if (property.type === 'SpreadElement') {
        const spread = this.property(this.resolveObject(property.argument as Node), name);
        if (spread) found = spread;
      } else if (property.type === 'Property' && keyName(property) === name) {
        found = property.value as Node;
      }
    }
    return found;
  }

  /** Keys of an object literal (spreads followed). */
  keys(object: Node | undefined): string[] {
    if (!object) return [];
    const keys: string[] = [];
    for (const property of object.properties as Node[]) {
      if (property.type === 'SpreadElement') keys.push(...this.keys(this.resolveObject(property.argument as Node)));
      else if (property.type === 'Property') {
        const key = keyName(property);
        if (key !== undefined) keys.push(key);
      }
    }
    return keys;
  }

  stringArray(node: Node | undefined): string[] {
    if (!node || node.type !== 'ArrayExpression') return [];
    return (node.elements as Array<Node | null>).map((el) => stringValue(el)).filter((v): v is string => !!v);
  }

  patterns(node: Node | undefined): Array<string | RegExp> | undefined {
    if (!node) return undefined;
    const toPattern = (el: Node | null): string | RegExp | undefined => {
      if (!el) return undefined;
      const regex = el.regex as { pattern: string; flags: string } | undefined;
      if (el.type === 'Literal' && regex) return new RegExp(regex.pattern, regex.flags);
      return stringValue(el);
    };
    if (node.type === 'ArrayExpression') {
      return (node.elements as Array<Node | null>).map(toPattern).filter((v): v is string | RegExp => v !== undefined);
    }
    const single = toPattern(node);
    return single === undefined ? undefined : [single];
  }

  mockSpecifiers(annotations: Node | undefined): string[] {
    const mocks = this.resolveObject(this.property(annotations, 'mocks'));
    return this.keys(this.resolveObject(this.property(mocks, 'modules')));
  }
}

/**
 * Statically parses a story file. Never evaluates it: the sidebar must be available before the
 * host's Next.js has compiled anything (NFR-1.1).
 */
export function parseStoryFile(source: string, filePath: string, relativePath: string): ParsedStoryFile {
  const warnings: string[] = [];
  // No `format`: esbuild then keeps exports where they are, so stories stay in file order.
  const { code } = transformSync(source, {
    loader: loaderFor(filePath),
    jsx: 'automatic',
    target: 'es2022',
    sourcefile: filePath,
  });
  const program = parseJs(code, { ecmaVersion: 'latest', sourceType: 'module' }) as unknown as Node;
  const scope = new ModuleScope(program);
  // From the source: esbuild drops type-only and unused imports.
  const isStorybook = /from\s+['"](?:@storybook\/|storybook\/)/.test(source);

  let metaNode: Node | undefined;
  const exportNames: string[] = [];
  const exportValues = new Map<string, Node | undefined>();
  for (const statement of program.body as Node[]) {
    if (statement.type === 'ExportDefaultDeclaration') {
      metaNode = scope.resolveObject(statement.declaration as Node);
    } else if (statement.type === 'ExportNamedDeclaration') {
      const declaration = statement.declaration as Node | null;
      if (declaration?.type === 'VariableDeclaration') {
        for (const declarator of declaration.declarations as Node[]) {
          const id = declarator.id as Node;
          if (id.type !== 'Identifier') continue;
          exportNames.push(id.name as string);
          exportValues.set(id.name as string, scope.resolveObject(declarator.init as Node));
        }
      } else if (declaration?.type === 'FunctionDeclaration' || declaration?.type === 'ClassDeclaration') {
        // Functions are not CSF story objects; record them so `isStoryExport` can exclude them.
        exportValues.set(((declaration.id as Node).name as string) ?? '', undefined);
      }
      for (const specifier of (statement.specifiers as Node[]) ?? []) {
        const exported = specifier.exported as Node;
        const name = (exported.name ?? exported.value) as string;
        const local = ((specifier.local as Node).name ?? name) as string;
        if (name === 'default') {
          metaNode = scope.resolveObject(scope.consts.get(local));
        } else {
          exportNames.push(name);
          exportValues.set(name, scope.resolveObject(scope.consts.get(local)));
        }
      }
    }
  }

  if (!metaNode) warnings.push('No default export (meta) found; the file is listed by path only.');
  const explicitTitle = stringValue(scope.property(metaNode, 'title'));
  const title = explicitTitle ?? titleFromPath(relativePath);
  const componentId = toComponentId(title, stringValue(scope.property(metaNode, 'id')));
  const includeStories = scope.patterns(scope.property(metaNode, 'includeStories'));
  const excludeStories = scope.patterns(scope.property(metaNode, 'excludeStories'));
  const metaTags = scope.stringArray(scope.property(metaNode, 'tags'));
  const metaHasPlay = !!scope.property(metaNode, 'play');
  const specifiers = new Set(scope.mockSpecifiers(metaNode));

  let component: ParsedStoryFile['component'];
  const componentNode = scope.property(metaNode, 'component');
  if (componentNode?.type === 'Identifier') {
    const localName = componentNode.name as string;
    const imported = scope.imports.get(localName);
    component = imported ? { localName, source: imported.source, importedName: imported.importedName } : { localName };
  } else if (componentNode?.type === 'MemberExpression') {
    const object = componentNode.object as Node;
    const prop = componentNode.property as Node;
    if (object.type === 'Identifier' && prop.type === 'Identifier') {
      const imported = scope.imports.get(object.name as string);
      component = {
        localName: `${object.name as string}.${prop.name as string}`,
        ...(imported ? { source: imported.source, importedName: prop.name as string } : {}),
      };
    }
  }

  const stories: IndexedStory[] = [];
  for (const exportName of exportNames) {
    const value = exportValues.get(exportName);
    if (
      !isStoryExport(exportName, {
        ...(includeStories ? { includeStories } : {}),
        ...(excludeStories ? { excludeStories } : {}),
      }) ||
      !value
    ) {
      continue;
    }
    for (const specifier of scope.mockSpecifiers(value)) specifiers.add(specifier);
    stories.push({
      exportName,
      id: toStoryId(componentId, exportName, stringValue(scope.property(value, 'id'))),
      name: stringValue(scope.property(value, 'name')) ?? storyNameFromExport(exportName),
      tags: [...metaTags, ...scope.stringArray(scope.property(value, 'tags'))],
      hasPlay: metaHasPlay || !!scope.property(value, 'play'),
    });
  }

  return {
    title,
    componentId,
    ...(component ? { component } : {}),
    stories,
    mockSpecifiers: [...specifiers].sort(),
    tags: metaTags,
    isStorybook,
    warnings,
  };
}

/** Mocked module specifiers in a preview/addon module's `mocks` export (static). */
export function parseMockSpecifiers(source: string, filePath: string): string[] {
  const { code } = transformSync(source, { loader: loaderFor(filePath), jsx: 'automatic', target: 'es2022' });
  const program = parseJs(code, { ecmaVersion: 'latest', sourceType: 'module' }) as unknown as Node;
  const scope = new ModuleScope(program);
  const mocks = scope.resolveObject(scope.consts.get('mocks'));
  return scope.keys(scope.resolveObject(scope.property(mocks, 'modules')));
}
