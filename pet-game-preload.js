const { contextBridge, ipcRenderer } = require('electron');

// Expose IPC methods to renderer
contextBridge.exposeInMainWorld('electronAPI', {
    getCurrentImage: () => ipcRenderer.invoke('get-current-image'),
    sendPetInteraction: (data) => ipcRenderer.send('pet-interaction', data),
    closePetGame: (data) => ipcRenderer.send('pet-game-close', data)
});
