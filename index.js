const express = require('express');
const { createServer } = require('node:http');
const { join } = require('node:path');
const { Server } = require('socket.io');
const { availableParallelism } = require('node:os');
const cluster = require('node:cluster');
const { createAdapter, setupPrimary } = require('@socket.io/cluster-adapter');

if (cluster.isPrimary) { //this is the primary thread, which is the main thread that runs the code, a worker is a thread that runs the code in parallel with the primary thread
    const numCPUs = availableParallelism(); //this is the number of available cores on the machine, this is used to determine how many workers to create
    // create one worker per available core, a core is a CPU that can run a thread, so if you have 4 cores, you will have 4 workers
    for (let i = 0; i < numCPUs; i++) {
      cluster.fork({
        PORT: 3000 + i
      });
    }
    
    // set up the adapter on the primary thread
    return setupPrimary();
} 

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

async function main() {

    const app = express();
    const server = createServer(app);
    const io = new Server(server, {
        connectionStateRecovery: {}
      }); //basically these sets up the server and socket.io

    io.adapter(createAdapter()); //this sets up the adapter for socket.io, this is used to communicate between the workers and the primary thread

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

io.on('connection', async (socket) => {

    const username = socket.handshake.auth.username || 'Anonymous';

    console.log(`${username} connected`);
    socket.on('disconnect', () => {
      console.log('user disconnected');
    });

    socket.on('chat message', async (msg, clientOffset, callback) => {
      let result;
      try {  //this is the message that will be sent to the client, it is a string that contains the username and the message
        message = `${username}: ${msg}`; //this is the message that will be sent to the client, it is a string that contains the username and the message
        result = await db.run('INSERT INTO messages (content, client_offset) VALUES (?, ?)', message, clientOffset); //this is the query that will be run when a user sends a message
      } catch (e) {
        if (e.errno === 19 /* SQLITE_CONSTRAINT */ ) { //19 is the error code for SQLITE_CONSTRAINT, which means that the message was already inserted
          // the message was already inserted, so we notify the client
          callback();
        } else {
          // nothing to do, just let the client retry
        }
        return;
      }
      io.emit('chat message', msg, result.lastID, username); 
      // acknowledge the event
      callback();
    });

    if (!socket.recovered) {
        // if the connection state recovery was not successful
        try {
          await db.each('SELECT id, content FROM messages WHERE id > ?',
            [socket.handshake.auth.serverOffset || 0],
            (_err, row) => {
              const [sender, ...msgParts] = row.content.split(': ');
            const message = msgParts.join(': ');
            socket.emit('chat message', message, row.id, sender);
            }
          )
        } catch (e) {
          // something went wrong
        }
      }
  });

  const port = process.env.PORT;

  server.listen(port, () => {
    console.log(`server running at http://localhost:${port}`);
  });

}

main();
// bale io.emit() emits an event arg1, while passing the args (arg2 etc) to the event handler.
// io.emit('event', arg1, arg2, ...);

//what is io? io is the instance of socket.io that is created when you call new Server(server).
//io is used to communicate with the server and send messages to all connected clients.

//what is handshake? handshake is the process of establishing a connection between the client and the server. It is used to authenticate the client and server and to exchange information between them. In this case, it is used to get the username and serverOffset from the client when they connect to the server. The handshake is done automatically by socket.io when you call io.on('connection', (socket) => {...}). The socket object contains information about the connection, such as the id of the socket, the handshake data, and the connection state.