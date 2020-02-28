const compression = require('compression');
const body_parser = require('body-parser');
const express = require('express');
const path = require('path');

const { database_handler } = require('./database_handler');
const { check_auth, reviver } = require('./authentication');

// Set to production environment
process.env.NODE_ENV = 'production';

// Initialize database and web-server
database_handler.init();
const app = express();

// Add universal middleware
app.use( compression() );
app.use(body_parser.json({
    limit: '5kb',
    reviver: reviver
}));

// Page requests
app.get('/', (request, response) => {
    response.sendFile(
        path.join(__dirname, '../build', 'index.html')
    );
});

// Handle new users
app.post('/signup', database_handler.new_user);

// Handle logins/authentication checks
app.post('/login', check_auth, database_handler.add_visit);

// Handle content requests
app.get('/get_content', check_auth, database_handler.get_contexts);

// Add ability to resolve other paths
app.use(express.static(path.join(__dirname, '../build')));

// Listener
app.listen(process.env.PORT || 8080, () => console.log('Server up.'));
