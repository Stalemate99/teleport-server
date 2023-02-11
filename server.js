const express = require("express");
const http = require("http");
const app = express();
const server = http.createServer(app);
const socket = require("socket.io");
const generate = require("./generate");
const io = socket(server);

const rooms = {}

const wordsToRoom = {};

const lanObj = {}

function advertise(arr, event, data = null) {
    arr.forEach((x) => x.emit(event, data));
}

app.get("/",(req,res)=>{
res.send("Hosted");
})


io.on('connection', socket => {
    const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;

    moveToSlave(ip, socket.id);

    socket.cip = ip;


    socket.on('generateKey',()=>{
        if(socket.master && socket.door){
            let newDoor=joiningProtocol(3);
            delete wordsToRoom[socket.door];
            wordsToRoom[newDoor]=socket.id;
            socket.door=newDoor;
            socket.emit('roomCreated', newDoor);
        }
    })

    socket.on('createRoom', ({
        socketId,
        nickname,
        door,private
    }) => {
        console.log("nickname entered", nickname)
        if(door){
            console.log("door",door);
            if(wordsToRoom[door] !== undefined){
                console.log("room exists")
                socket.emit('roomCodeExists');
                door=joiningProtocol(private==true?4:3);
            }
        }else{
            console.log("changing");
            door=joiningProtocol(private==true?4:3);
        }
      
        wordsToRoom[door] = socket.id;
        socket.master = true;
        socket.door = door;
        if(private){
            socket.visible=false;
            moveToSlave(socket.cip,socketId)
        }else{
            socket.visible = true;
            moveToMaster(socket.cip, socketId);
        }
   

        //Else add to existing list of rooms --> update master socket
        rooms[socketId] = {
            peers: [],
            nickname
        }

        let updatedRooms = allMasterRooms(socket);

        traverse("slave", socket.cip, (slave) => {
            io.to(slave).emit('localrooms', updatedRooms);
        })

        console.log("emitting dooor",door);

        socket.emit('roomCreated', door);

    })

    socket.on("search", () => {
        socket.emit('localrooms', allMasterRooms(socket))
    });

    socket.on("rejectPermission",(sockid)=>{
        console.log("Exiists");
        console.log("\n");
        console.log(io.to(sockid));
        io.to(sockid).emit("permissionDenied");
    })


    socket.on('leaveRoom', () => {
        if (socket.master) {
            leaveMaster(socket);
        } else {
            leaveSlave(socket);
        }
    });


    //Check if room name exists, yes return master socket id, else emit error event
    socket.on('joinRoom', ({
        sourceSocket,
        roomName,
        nickname
    }) => {


        if (!sourceSocket) {
            sourceSocket = findKey(roomName);
        }
        console.log('sid',socket.id);
        console.log('ss',sourceSocket);

        //Checking if given room name exists
        if (sourceSocket && rooms[sourceSocket]) {

            socket.room = sourceSocket;

            //Appending current peer socket id to peers array
            rooms[sourceSocket].peers.push(socket)
            
  
            io.to(sourceSocket).emit('newPeerJoined', [socket.id, nickname]);

            //Emiting master socket to connect to it
            console.log("gonna send");
            // socket.emit('getMasterId', sourceSocket);
            console.log("sent" + socket)

        } else {
            //Sending Error event
            socket.emit('joinRoomError')
        }
    });

    //Connect to the slave peer
    socket.on("connectPeer", (data) => {
        //Sending signal data of current peer to master peer
        console.log("hit", data);
        io.to(data.userToCall).emit('incomingConnection', {
            signal: data.signal,
            from: data.from,
            masterNickname: data.masterNickname
        })
    })

    //Accept and return offer
    socket.on("acceptConnection", (data) => {
        console.log("accepted",data.to);
        io.to(data.to).emit('connectionAccepted', {
            sockid: socket.id,
            signal: data.signal
        })
    });

    socket.on("disconnect", () => {
        console.log("closing");
        if (socket.master) {
            leaveMaster(socket, true);
        }
        leaveSlave(socket, true);

    })

    socket.on("visibility",(data) => {
        if((socket.id in rooms) && (socket.visible != data)) {
            socket.visible = data;
            if(data) {
                moveToMaster(socket.cip, socket.id)
            } else {
                moveToSlave(socket.cip,socket.id)
            }
            let updatedRooms = allMasterRooms(socket);
            traverse("slave", socket.cip, (slave) => {
                io.to(slave).emit('localrooms', updatedRooms);
            })
        }
    })

})

function leaveMaster(socket, dead = false) {
    const room = rooms[socket.id];
    socket.master = false;
    if (!dead)
        advertise([socket], 'forceEject');
    advertise(room.peers, 'forceEject')
    delete rooms[socket.id];
    delete wordsToRoom[socket.door];
    moveToSlave(socket.cip, socket.id);
    socket.door = null;
    var updatedRooms = allMasterRooms(socket);
    traverse("slave", socket.cip, (slave) => {
        if (slave == socket.id && dead) {
            return;
        }
        io.to(slave).emit("localrooms", updatedRooms);
    });
}

function leaveSlave(socket, dead = false) {
    if ("room" in socket) {
        io.to(socket.room).emit('eject', socket.id);
    }
    if (!dead) {
        socket.emit('eject', socket.room);
        return;
    }

    remove("slave", socket.cip, socket.id);
}

function findKey(door) {
    return wordsToRoom[door];
}

function allMasterRooms(socket) {
    var masterRooms = []
    traverse("master", socket.cip, (master) => {
        console.log('master :',rooms[master]);
        masterRooms.push({
            nickname: rooms[master].nickname,
            sourceSocket: master
        });
    });
    return masterRooms;
}

function moveToSlave(ip, sockid) {
    if (!lanObj[ip]) {
        lanObj[ip] = {
            master: [],
            slave: [sockid]
        }
    } else {
        lanObj[ip].master = lanObj[ip].master.filter(x => x !== sockid);
        lanObj[ip].slave.push(sockid);
    }
}

function traverse(key, ip, cb) {
    if(lanObj){
        lanObj[ip][key].forEach((sock) => {
            cb(sock);
        })
    }
  
}

function remove(key, ip, sockid) {
    lanObj[ip][key] = lanObj[ip][key].filter(x => x !== sockid);
    if (lanObj[ip]["master"].length === 0 && lanObj[ip]["slave"].length === 0) {
        delete lanObj[ip];
    }
}

function moveToMaster(ip, sockid) {
    lanObj[ip].slave = lanObj[ip].slave.filter(x => x !== sockid);
    lanObj[ip].master.push(sockid);
}

//gets the key given the door

// door (3 words) -> key (sockid) = wordsToRoom

function joiningProtocol(n) {
    const door = generate(n);
    if (wordsToRoom[door] !== undefined) {
        return joiningProtocol();
    }
    return door;
}

server.listen(process.env.PORT || 8000);
console.log("Started")