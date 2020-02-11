/* eslint-disable indent */
/*eslint-env node */
let mysql = require('mysql2');

function createCon(credentials) {
	let connection = mysql.createConnection({
		host: credentials.host,
		user: credentials.user,
		password: credentials.password,
		database: credentials.database
	});
	return connection;
}
/**
 * 
 * @param {String} query Sql query
 * @param {Object} connection database connection
 * @param {Function} callback function to run when done stuff
 */
function sendQuery(query, connection, callback) {
	connection.query(query, function (err, results, fields) { // add fields param if desired
		// if (err) throw err;
		// console.log(results); // results contains rows returned by server
		// console.log(fields); // fields contains extra meta data about results, if available    
		callback(err, results, fields);
	});
}

function mysql_real_escape_string(str) {
	// eslint-disable-next-line no-control-regex
	return str.replace(/[\0\x08\x09\x1a\n\r"'\\%]/g, function (char) {
		switch (char) {
			case '\0':
				return '\\0';
			case '\x08':
				return '\\b';
			case '\x09':
				return '\\t';
			case '\x1a':
				return '\\z';
			case '\n':
				return '\\n';
			case '\r':
				return '\\r';
			case '"':
			case '\'':
			case '\\':
			case '%':
				return '\\' + char; // prepends a backslash to backslash, percent,
			// and double/single quotes
			default:
				return char;
		}
	});
}

module.exports.mysql_real_escape_string = mysql_real_escape_string;
module.exports.createCon = createCon;
module.exports.sendQuery = sendQuery;