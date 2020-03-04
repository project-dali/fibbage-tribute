let io;
let gameSocket;

// const request = require('request');
var Config = require('./public/config.json');
// const NODE_ENV = process.env.NODE_ENV || 'dev';

// Import Database credentials and functions
const db = require('./db');
const secret = require('./db-secret');

// Create db connection
let connection = db.createCon(secret.dbCredentials);

// store the questions for game in here
let questions = [];
let switchups = [];

const numRounds = Config.numRounds;

/**
 * This function is called by index.js to initialize a new game instance.
 *
 * @param sio The Socket.IO library
 * @param socket The socket object for the connected client.
 */
exports.initGame = function (sio, socket) {
	io = sio;
	gameSocket = socket;
	getSystemAvatars().then((results) => {
		gameSocket.emit('connected', { message: 'You are connected!', avatarList: results });
	});

	// Host Events
	gameSocket.on('hostCreateNewGame', hostCreateNewGame);
	gameSocket.on('hostRoomFull', hostPrepareGame);
	gameSocket.on('hostCountdownFinished', hostStartGame);
	gameSocket.on('hostNextRound', hostNextRound);
	gameSocket.on('allPloysSent', allPloysSent);
	// Player Events
	gameSocket.on('playerJoinGame', playerJoinGame);
	gameSocket.on('playerSelectNameAvatar', playerSelectNameAvatar);
	gameSocket.on('playerLaunchGameClick', playerLaunchGameClick);
	gameSocket.on('playerAnswer', playerAnswer);
	gameSocket.on('playerSendPloy', playerSendPloy);
	gameSocket.on('playerRestart', playerRestart);
	gameSocket.on('throwError', throwError);
};

/* *******************************
   *                             *
   *       HOST FUNCTIONS        *
   *                             *
   ******************************* */

/**
 * The 'START' button was clicked and 'hostCreateNewGame' event occurred.
 */
function hostCreateNewGame() {
	/**
	 * generates random 6 digit room code
	 * CAUTION. theoretically it is possible to generate the
	 * same room code as another host
	 * @returns string roomId
     */
	let createRoomId = () => {
		let roomID = '';
		for (let i = 0; i < 6; i++) {
			roomID += String(Math.floor(Math.random() * 10));
		}
		while (roomID < 100000) {
			roomID = 0;
			for (let i = 0; i < 6; i++) {
				roomID += String(Math.floor(Math.random() * 10));
			}
		}
		roomID = parseInt(roomID);
		return roomID;
	};

	// Create a unique Socket.IO Room
	let thisGameId = createRoomId();

	// Return the Room ID (gameId) and the socket ID (mySocketId) to the browser client
	this.emit('newGameCreated', { gameId: thisGameId, mySocketId: this.id });

	// Join the Room and wait for the players
	this.join(thisGameId.toString());
}

/*
 * Two players have joined. Alert the host!
 * @param gameId The game ID / room ID
 */
function hostPrepareGame(data) {
	var sock = this;

	data.mySocketId = sock.id;

	/**
	 * Searches database to see if this room code exists
	 * @param {string} __roomID 6 digit room code
	 * @returns {boolean} does this roomID exist?
	 */
	let getPrompt = (amount) => {
		return new Promise((resolve) => {
			let query = `SELECT * FROM thunk.prompt 
			WHERE round_type='think_twice'
			ORDER BY RAND()
			LIMIT ${amount};`;

			db.sendQuery(query, connection, (err, results, fields) => {
				if (err) { // if duplicate entry, make a new code and try again
					throw err;
				}
				if (results.length > 0) { // a room with this ID exists
					resolve(results);
				} else {
					resolve(false); // this should be a reject probably
				}
			});
		});
	};

	// change to 6 when adding to production
	getPrompt(numRounds).then((results) => {
		questions = [];

		for (let textRow of results) {
			questions.push({
				question: textRow.prompt,
				solution: textRow.author
			});
		}

		io.sockets.in(data.gameId).emit('beginNewGame', data);
	});

	let getSwitchUp = (amount) => {
		return new Promise((resolve) => {
			let query = `SELECT * FROM thunk.switch_up 
			WHERE round_type='think_twice'
			ORDER BY RAND()
			LIMIT ${amount};`;

			db.sendQuery(query, connection, (err, results, fields) => {
				if (err) { // if duplicate entry, make a new code and try again
					throw err;
				}
				if (results.length > 0) { // a room with this ID exists
					resolve(results);
				} else {
					resolve(false); // this should be a reject probably
				}
			});
		});
	};

	getSwitchUp(numRounds-1).then((results) => {
		console.log(results);

		switchups = [];

		for (let textRow of results) {
			switchups.push({
				switchup: textRow.switch_up
			});
		}

		console.log(switchups);

		io.sockets.in(data.gameId).emit('beginNewGame', data);
	});
}

/*
 * The Countdown has finished, and the game begins!
 * @param gameId The game ID / room ID
 */
function hostStartGame(gameId) {
	sendQuestion(0, gameId);
}

/**
 * A player answered correctly. Time for the next word.
 * @param data Sent from the client. Contains the current round and gameId (room)
 */
function hostNextRound(data) {
	if (data.round < questions.length) {
		// Send a new set of words back to the host and players.
		sendQuestion(data.round, data.gameId);
	} else {
		// If the current round exceeds the number of words, send the 'gameOver' event.
		io.sockets.in(data.gameId).emit('gameOver', data);
	}
}

/**
 * All ploys have been sent.
 * @param data Sent from the host. Contains the current round, the gameId (room) and the ploys.
 */
function allPloysSent(data) {
	var ploys = shuffle(data.ploys.slice());

	data.list = ploys;

	io.sockets.in(data.gameId).emit('ploysList', data);
}

/* *****************************
   *                           *
   *     PLAYER FUNCTIONS      *
   *                           *
   ***************************** */

/**
 * A player clicked the 'START GAME' button.
 * Attempt to connect them to the room that matches
 * the gameId entered by the player.
 * @param data Contains data entered via player's input - playerName and gameId.
 */
function playerJoinGame(data) {
	//console.log('Player ' + data.playerName + 'attempting to join game: ' + data.gameId );
	// console.log('player joining game with avatar: ' + data.playerAvatar);
	// A reference to the player's Socket.IO socket object
	var sock = this;

	// Look up the room ID in the Socket.IO manager object.
	var room = gameSocket.manager.rooms['/' + data.gameId];

	// If the room exists...
	if (room != undefined) {
		// attach the socket id to the data object.
		data.playerId = sock.id;

		// Join the room
		sock.join(data.gameId);

		//console.log('Player ' + data.playerName + ' joining game: ' + data.gameId );

		// Emit an event notifying the clients that the player has joined the room.
		io.sockets.in(data.gameId).emit('playerJoinedRoom', data);

	} else {
		// Otherwise, send an error message back to the player.
		this.emit('error', { message: 'This room does not exist.' });
	}
}

function throwError(errorMessage) {
	this.emit('error', { message: errorMessage });
}

/**
 * 
 * @param {object} data data.playerName, data.playerAvatar
 */
function playerSelectNameAvatar(data) {
	io.sockets.in(data.gameId).emit('playerJoinRoomWithNameAvatar', data);

}

function playerLaunchGameClick(gameId) {
	io.sockets.in(gameId).emit('hostLaunchGame', gameId);
}

/**
 * A player has written a ploy.
 * @param data gameId
 */
function playerSendPloy(data) {
	// console.log('Player ID: ' + data.playerId + ' answered a question with: ' + data.answer);

	// The player's ploy is attached to the data object.  \
	// Emit an event with the ploy so it can be saved by the 'Host'
	io.sockets.in(data.gameId).emit('hostSavePloy', data);
}

/**
 * A player has tapped a word in the word list.
 * @param data gameId
 */
function playerAnswer(data) {
	// console.log('Player ID: ' + data.playerId + ' answered a question with: ' + data.answer);

	// The player's answer is attached to the data object.  \
	// Emit an event with the answer so it can be checked by the 'Host'
	io.sockets.in(data.gameId).emit('hostCheckAnswer', data);
}

/**
 * The game is over, and a player has clicked a button to restart the game.
 * @param data
 */
function playerRestart(data) {
	// console.log('Player: ' + data.playerName + ' ready for new game.');

	// Emit the player's data back to the clients in the game room.
	data.playerId = this.id;
	io.sockets.in(data.gameId).emit('playerJoinRoomWithNameAvatar', data);
}

/* *************************
   *                       *
   *      GAME LOGIC       *
   *                       *
   ************************* */

function getSystemAvatars() {
	return new Promise((resolve) => {
		let query = 'SELECT * FROM thunk.avatar';

		db.sendQuery(query, connection, (err, results, fields) => {
			if (err) {
				throw err;
			}
			if (results.length > 0) { // good
				resolve(results);
			} else {
				resolve(false); // this should be a reject probably
			}
		});
	});
}

/**
 * Get a word for the host, and a list of words for the player.
 *
 * @param wordPoolIndex
 * @param gameId The room identifier
 */
function sendQuestion(wordPoolIndex, gameId) {

	var json = questions[wordPoolIndex];
	json.answer = json.solution;
	json.round = wordPoolIndex;
	if(wordPoolIndex > 0) {
		json.switchup = switchups[wordPoolIndex-1].switchup;
	}
	io.sockets.in(gameId).emit('newQuestion', json);
}

/*
 * Javascript implementation of Fisher-Yates shuffle algorithm
 * http://stackoverflow.com/questions/2450954/how-to-randomize-a-javascript-array
 */
function shuffle(array) {
	var currentIndex = array.length;
	var temporaryValue;
	var randomIndex;

	// While there remain elements to shuffle...
	while (0 !== currentIndex) {

		// Pick a remaining element...
		randomIndex = Math.floor(Math.random() * currentIndex);
		currentIndex -= 1;

		// And swap it with the current element.
		temporaryValue = array[currentIndex];
		array[currentIndex] = array[randomIndex];
		array[randomIndex] = temporaryValue;
	}

	return array;
}
