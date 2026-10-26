// Programmatic API: run the workshop, render stories and analyse RSC payloads from scripts.
export { WorkshopServer, type WorkshopServerOptions } from './server/server';
export { startServer, nextBuild, type StartOptions } from './production';
export { loadProject, type Project } from './project';
export { createIndex, findStory, type StoryIndex, type IndexedFile, type IndexedStory } from './indexer';
export { FlightPayload, extractInlineFlight, parseFlight, decodeForDisplay, type FlightRow } from './inspector/flight';
export { buildTree, storyPayloadBytes, type InspectorNode, type Boundary } from './inspector/tree';
export { normalizeHtml, serverStoryHtml, resolveStreamedHtml, diffLines, type DiffLine } from './inspector/html';
export type { InspectorReport, BudgetResult, NonSerializableProp, TimelineEntry } from './inspector/report';
