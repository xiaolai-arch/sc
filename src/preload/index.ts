import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { createStudyCoachBridge } from '../main/ipc';

contextBridge.exposeInMainWorld(
  'studyCoach',
  createStudyCoachBridge(
    (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    (channel, listener) => {
      const wrapped = (_event: IpcRendererEvent, payload: unknown) => listener(payload);
      ipcRenderer.on(channel, wrapped);
      return () => ipcRenderer.removeListener(channel, wrapped);
    }
  )
);
