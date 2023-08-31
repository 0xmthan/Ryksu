const { ipcRenderer } = require('electron');

var input = document.getElementById("PassE");
input.addEventListener("keypress", function(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    document.getElementById("open-btn").click();
  }
});
document.getElementById('open-btn').addEventListener('click', (event, data) => {
    var Epass = document.getElementById('PassE').value;
    ipcRenderer.send('open-app', Epass);
});
ipcRenderer.on('perr', () => {
    document.getElementById('wpass').style.display = "block";
});
document.getElementById('close-btn').addEventListener('click', () => {
  ipcRenderer.send('close-app');
});
document.getElementById('lmin-btn').addEventListener('click', () => {
  ipcRenderer.send('lmin-app');
});
alert("It was a fun little project, but Mineflier was quite an annoying package to work with. With every Minecraft update, everything got broken. I'm not going to continue this project. It was my first time trying Electron, and I liked it. Now I have to find a new project, though. :) Bye!")
alert("The app has so many bugs and honestly, I don't recommend you to test it or start working on it again... Please DONT")
