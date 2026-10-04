import { projectMetadata } from './project';

export function App() {
  return (
    <main>
      <p>{projectMetadata.environment}</p>
      <h1>{projectMetadata.name}</h1>
      <p>{projectMetadata.city} · deterministic simulation initializing</p>
    </main>
  );
}
