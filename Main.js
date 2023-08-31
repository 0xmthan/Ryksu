const { app, BrowserWindow, globalShortcut, ipcMain, remote, dialog } = require('electron')
const speakeasy = require('speakeasy')
app.disableHardwareAcceleration() 
const ElectronStore = require('electron-store');
ElectronStore.initRenderer();
function createWindow() {
    var mainwindow = new BrowserWindow({ 
        width: 1187, 
        height: 600, 
        transparent: true, 
        frame: false, 
        show: false,
        resizable: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true,
            nodeIntegrationInWorker: true,
          }
    });
    mainwindow.loadFile('./FatEcat.html')
    var splash = new BrowserWindow({ 
        width: 280, 
        height: 420, 
        transparent: true, 
        frame: false, 
        alwaysOnTop: true ,
        show: false,
        resizable: false,
    });
    splash.loadFile('./splash_loading.html');
    splash.center();

    app.on('ready', () => {
      splash.show();
    })

    var login = new BrowserWindow({ 
        width: 280, 
        height: 420, 
        transparent: true, 
        frame: false,
        show: false,
        resizable: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true,
            nodeIntegrationInWorker: true,
          },
    });
    login.loadFile('./login.html')
    setTimeout(function () {
        splash.close();
        login.center();
        login.show();
    }, 10000);

    ipcMain.on('lmin-app', () => {
        login.minimize();
    });
    ipcMain.on('mmin-app', () => {
        mainwindow.minimize();
    });
    ipcMain.on('close-app', () => {
        app.quit()
    });
    ipcMain.on('open-app', (e, data) => {
        var twofa = speakeasy.totp.verify({
            secret: 'aAl*FV/1qdTRG*xmW?wQ]a:F0!y,PWqe',
            encoding: 'ascii',
            token: data
        })
        twofa_debug = true //remove this line and _debug down, on build
        if (twofa_debug === true) {
            mainwindow.show(); 
            login.close();
        } else {
            login.webContents.send('perr');
        }
    });
    //make a bether login with a android app 

    ipcMain.on('viewer', (e, data) => {
      var viewer = new BrowserWindow({
        backgroundColor: 'black',
      });
      viewer.loadURL('http://localhost:3009/');
    });
    ipcMain.on('inventory', (e, data) => {
      var viewer = new BrowserWindow({
        width: 375,
        height: 540,
        backgroundColor: 'black',
        resizable: false,
      });
      viewer.loadURL('http://localhost:3001/');
    });
  ipcMain.on('radar', (e, data) => {
    var viewer = new BrowserWindow({
      width: 470,
      height: 470,
      backgroundColor: 'black',
      resizable: false,
    });
    viewer.loadURL('http://localhost:3002/');
  });
  ipcMain.on('control', (e, data) => {
    var viewer = new BrowserWindow({
      backgroundColor: 'black',
    });
    viewer.loadURL('https://webclient.prismarine.js.org/');
  });
}
app.whenReady().then(() => {
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})
