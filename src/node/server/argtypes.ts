import { readFileSync, statSync } from 'node:fs';
import type { ControlType } from '../../types';

/** An arg type inferred from the component's TypeScript props (FR-4.3). */
export interface InferredArgType {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  defaultValue?: string;
  control: ControlType | false;
  options?: Array<string | number | boolean>;
  action?: boolean;
}

// The TypeScript compiler API is only used structurally; the host's own `typescript` is loaded at
// runtime so the workshop never pins a second TypeScript.
type TS = typeof import('typescript');
type LanguageService = import('typescript').LanguageService;
type Type = import('typescript').Type;
type TypeChecker = import('typescript').TypeChecker;
type Node = import('typescript').Node;

interface ServiceState {
  ts: TS;
  service: LanguageService;
  files: Map<string, { version: number; mtime: number }>;
}

const COLOR_NAME = /(colou?r|background|fill|stroke|tint)$/i;

function literalOptions(ts: TS, type: Type): Array<string | number | boolean> | undefined {
  if (!type.isUnion()) return undefined;
  const values: Array<string | number | boolean> = [];
  for (const member of type.types) {
    if (member.flags & ts.TypeFlags.Undefined || member.flags & ts.TypeFlags.Null) continue;
    if (member.isStringLiteral() || member.isNumberLiteral()) values.push(member.value);
    else if (member.flags & ts.TypeFlags.BooleanLiteral) {
      values.push((member as unknown as { intrinsicName: string }).intrinsicName === 'true');
    } else return undefined;
  }
  return values.length ? [...new Set(values)] : undefined;
}

function controlFor(ts: TS, checker: TypeChecker, name: string, type: Type): Pick<InferredArgType, 'control' | 'options' | 'action'> {
  const nonNullable = checker.getNonNullableType(type);
  if (nonNullable.getCallSignatures().length > 0) return { control: false, action: true };
  const options = literalOptions(ts, nonNullable);
  if (options) {
    if (options.every((o) => typeof o === 'boolean')) return { control: 'boolean' };
    return { control: options.length <= 4 ? 'radio' : 'select', options };
  }
  const flags = nonNullable.flags;
  if (flags & ts.TypeFlags.BooleanLike) return { control: 'boolean' };
  if (flags & ts.TypeFlags.NumberLike) return { control: 'number' };
  if (flags & ts.TypeFlags.StringLike) return { control: COLOR_NAME.test(name) ? 'color' : 'text' };
  const text = checker.typeToString(nonNullable);
  if (text === 'Date') return { control: 'date' };
  if (/ReactNode|ReactElement|JSX\.Element|ReactPortal/.test(text)) return { control: false };
  if (/^Promise</.test(text)) return { control: false };
  if (checker.isArrayType(nonNullable) || flags & ts.TypeFlags.Object) return { control: 'object' };
  return { control: 'text' };
}

/**
 * Infers arg types from the props of `meta.component`, using the host's TypeScript language
 * service. Returns `undefined` when TypeScript is unavailable (JavaScript projects): controls then
 * fall back to inference from arg values.
 */
export class ArgTypeInference {
  private state?: ServiceState | null;

  constructor(
    private readonly root: string,
    private readonly requireFromHost: NodeJS.Require,
    private readonly tsconfigFile?: string,
  ) {}

  private load(): ServiceState | null {
    if (this.state !== undefined) return this.state;
    try {
      const ts = this.requireFromHost('typescript') as TS;
      if (typeof ts.createLanguageService !== 'function') return (this.state = null);
      const files = new Map<string, { version: number; mtime: number }>();
      let options: import('typescript').CompilerOptions = { jsx: ts.JsxEmit.ReactJSX, allowJs: true, strict: true };
      if (this.tsconfigFile) {
        const config = ts.readConfigFile(this.tsconfigFile, ts.sys.readFile);
        const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, this.root);
        options = { ...parsed.options, noEmit: true };
      }
      const host: import('typescript').LanguageServiceHost = {
        getScriptFileNames: () => [...files.keys()],
        getScriptVersion: (file) => {
          const entry = files.get(file);
          if (!entry) return '0';
          try {
            const mtime = statSync(file).mtimeMs;
            if (mtime !== entry.mtime) {
              entry.mtime = mtime;
              entry.version++;
            }
          } catch {
            // Deleted file.
          }
          return String(entry.version);
        },
        getScriptSnapshot: (file) => {
          try {
            return ts.ScriptSnapshot.fromString(readFileSync(file, 'utf8'));
          } catch {
            return undefined;
          }
        },
        getCurrentDirectory: () => this.root,
        getCompilationSettings: () => options,
        getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
        fileExists: ts.sys.fileExists,
        readFile: ts.sys.readFile,
        readDirectory: ts.sys.readDirectory,
        directoryExists: ts.sys.directoryExists,
        getDirectories: ts.sys.getDirectories,
      };
      this.state = { ts, service: ts.createLanguageService(host, ts.createDocumentRegistry()), files };
      return this.state;
    } catch {
      return (this.state = null);
    }
  }

  /** Props of the default export's `component`, keyed by prop name. */
  infer(storyFile: string): Record<string, InferredArgType> | undefined {
    const state = this.load();
    if (!state) return undefined;
    const { ts, service, files } = state;
    if (!files.has(storyFile)) files.set(storyFile, { version: 1, mtime: 0 });
    const program = service.getProgram();
    const source = program?.getSourceFile(storyFile);
    if (!program || !source) return undefined;
    const checker = program.getTypeChecker();
    let componentNode: Node | undefined;
    const findComponent = (node: Node): void => {
      if (componentNode) return;
      if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'component') {
        // Only the meta object's `component`: its object literal must be the default export's.
        componentNode = node.initializer;
        return;
      }
      ts.forEachChild(node, findComponent);
    };
    for (const statement of source.statements) {
      if (ts.isExportAssignment(statement)) {
        let expression: Node = statement.expression;
        if (ts.isIdentifier(expression)) {
          const symbol = checker.getSymbolAtLocation(expression);
          const declaration = symbol?.valueDeclaration;
          if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
            expression = declaration.initializer;
          }
        }
        findComponent(expression);
      }
    }
    if (!componentNode) return undefined;
    const componentType = checker.getTypeAtLocation(componentNode);
    const signature = componentType.getCallSignatures()[0] ?? componentType.getConstructSignatures()[0];
    const propsParam = signature?.getParameters()[0];
    if (!propsParam) return {};
    const propsType = checker.getTypeOfSymbolAtLocation(propsParam, componentNode);
    const out: Record<string, InferredArgType> = {};
    for (const property of checker.getPropertiesOfType(propsType)) {
      const name = property.getName();
      if (name === 'key' || name === 'ref') continue;
      const declaration = property.valueDeclaration ?? property.declarations?.[0];
      // Skip props inherited from DOM/React typings; they would flood the panel.
      if (declaration && declaration.getSourceFile().fileName.includes('node_modules')) continue;
      const type = checker.getTypeOfSymbolAtLocation(property, componentNode);
      const description = ts.displayPartsToString(property.getDocumentationComment(checker)) || undefined;
      const defaultTag = property.getJsDocTags(checker).find((tag) => tag.name === 'default');
      out[name] = {
        name,
        type: checker.typeToString(type),
        required: (property.flags & ts.SymbolFlags.Optional) === 0,
        ...(description ? { description } : {}),
        ...(defaultTag?.text ? { defaultValue: ts.displayPartsToString(defaultTag.text) } : {}),
        ...controlFor(ts, checker, name, type),
      };
    }
    return out;
  }
}
