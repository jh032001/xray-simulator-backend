const mysql = require('mysql2/promise');

let pool;

if (process.env.MYSQL_URL) {
    pool = mysql.createPool(process.env.MYSQL_URL + '?waitForConnections=true&connectionLimit=10');
} else {
    pool = mysql.createPool({
        host:     process.env.MYSQLHOST     || 'localhost',
        user:     process.env.MYSQLUSER     || 'root',
        password: process.env.MYSQLPASSWORD || '',
        database: process.env.MYSQLDATABASE || 'xray_simulator',
        port:     process.env.MYSQLPORT     || 3306,
        waitForConnections: true,
        connectionLimit:    10,
    });
}

module.exports = pool;
