/**
 * @deprecated Use agent-folder.ts. Re-exports for backward compatibility.
 */
export {
  isValidAgentFolder as isValidGroupFolder,
  resolveAgentFolderPath as resolveGroupFolderPath,
  resolveAgentIpcPath as resolveGroupIpcPath,
} from './agent-folder.js';
