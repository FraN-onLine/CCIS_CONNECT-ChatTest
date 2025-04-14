const express = require('express');
const { createServer } = require('node:http');
const { join } = require('node:path');
const { Server } = require('socket.io');

const app = express();
const server = createServer(app);
const io = new Server(server, {
    connectionStateRecovery: {}
  }); //basically these sets up the server and socket.io

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

async function main() {
  // open the database file
  const db = await open({
    filename: 'chat.db',
    driver: sqlite3.Database
  });

  // create our 'messages' table (you can ignore the 'client_offset' column for now)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_offset TEXT UNIQUE,
        content TEXT
    );
  `);


app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'index.html')); //this is the file that will be served when you go to localhost:3000
});

io.on('connection', (socket) => { //this is the event that is fired when a user connects to the server
    console.log('a user connected');
    socket.on('disconnect', () => {
      console.log('user disconnected');
    });
  });

server.listen(3000, () => {
  console.log('server running at http://localhost:3000');
});

io.on('connection', async (socket) => {
    socket.on('chat message', async (msg) => { //this is the event that is fired when a user sends a message, async is used to wait for the database to finish before sending the message
      let result;
      try {
        // store the message in the database
        result = await db.run('INSERT INTO messages (content) VALUES (?)', msg);
      } catch (e) {
        // TODO handle the failure
        return;
      }
      // include the offset with the message
      io.emit('chat message', msg, result.lastID);//this sends the message to all connected users
    });

    if (!socket.recovered) {
        // if the connection state recovery was not successful
        try {
          await db.each('SELECT id, content FROM messages WHERE id > ?',
            [socket.handshake.auth.serverOffset || 0],
            (_err, row) => {
              socket.emit('chat message', row.content, row.id);
            }
          )
        } catch (e) {
          // something went wrong
        }
      }
  });

}

main();
// bale io.emit() emits an event arg1, while passing the args (arg2 etc) to the event handler.
// io.emit('event', arg1, arg2, ...);

//what is io? io is the instance of socket.io that is created when you call new Server(server).
//io is used to communicate with the server and send messages to all connected clients.

