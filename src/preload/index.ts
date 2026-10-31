import { contextBridge, ipcRenderer } from 'electron';
import { createStudyCoachBridge } from '../main/ipc';

contextBridge.exposeInMainWorld(
  'studyCoach',
  createStudyCoachBridge((channel, ...args) => ipcRenderer.invoke(channel, ...args))
);
