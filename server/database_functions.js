const { Database } = require('sqlite3').verbose();
const { queries } = require('./queries');
const { error_thrower, empty_promise } = require('./utilities');
const { generate_token } = require('./authentication');

const label_map = {
    true: 'POSITIVE',
    false: 'NEGATIVE'
};

const run_callback = (resolve, reject) => (e) => {
    if (e)
        reject(e);
    resolve();
};

const get_callback = (resolve, reject) => (e, data) => {
    if (e)
        reject(e);
    resolve(data);
};

// Define Database handler
let database_handler = {
    db: null,
    init: () => {
        this.db = new Database('./labelling_database.sdb')
    },

    // Convert generic database actions to promise
    db_action: (action, query, parameters, callback_generator) => (
        new Promise((resolve, reject) => {
            const callback = callback_generator(resolve, reject);

            if (!!parameters)
                this.db[action](query, parameters, callback);
            else
                this.db[action](query, callback);
        })
    ),

    // Promise version of specific actions
    run: (query, parameters=null) => database_handler.db_action('run', query, parameters, run_callback),
    get: (query, parameters=null) => database_handler.db_action('get', query, parameters, get_callback),
    all: (query, parameters=null) => database_handler.db_action('all', query, parameters, get_callback),

    // Add new user to database
    new_user: (request, response) => {
        const { user_type } = request.body;

        // Insert new user
        database_handler.run(queries.insert_user, user_type)
            // Get user profile
            .then(() => database_handler.get(queries.get_last_user))
            
            // Generate user token
            .then(new_user => {
                console.log('New user', new_user);
                request.user = new_user;

                // Generate auth token for user and return it
                return generate_token(new_user)
            })

            // Send auth token
            .then(auth_token => {
                response.send({ auth_token });
                database_handler.add_visit(request, response, false);
            })
            .catch(error_thrower);
    },

    add_visit: (request, response, send_response=true) => {
        if (send_response)
            response.sendStatus(200);   // OK status

        const client_ip = request.headers['x-forwarded-for'];
        const { user_id } = request.user;
        const package = [user_id, client_ip];

        database_handler.run(queries.insert_visit, package)
    },

    // Add user labels to database
    add_labels: (labels, user_id, last_label_index) => {
        if (!labels)
            return empty_promise();
                
        // Get visit id
        return database_handler.get(queries.get_visit, [ user_id ])
            // For each label
            .then(({ visit_id }) => (
                Promise.all(
                    // Insert and wait for them all to be inserted
                    labels.map((label, index) => {
                        // TODO find better way to parse label... sketchy...
                        const { intent_label, abuse_label } = JSON.parse(label);
                        const package = [
                            (last_label_index + index + 1),
                            user_id,
                            visit_id,
                            intent_label,
                            abuse_label
                        ];
    
                        return database_handler.run(queries.insert_label, package)
                    })
                )
            ));
    },

    // Get contexts for user
    get_contexts: (request, response) => {
        const { user_id } = request.user;
        const { labels } = request.query;
        let last_label_index;

        // Get index of the last inserted label
        database_handler.get(queries.get_last_label, [ user_id ])
            // Insert old labels
            .then(last_label => {
                last_label_index = !last_label? -1 : last_label.context_id;

                return database_handler.add_labels(labels, user_id, last_label_index);
            })
            // Get next set of contexts to label
            .then(() => {                
                last_label_index = (!!labels)? last_label_index + labels.length : last_label_index;
                
                return database_handler.all(queries.get_contexts, [ last_label_index ])
            })
            // Send contexts back to client
            .then(contexts => {
                // If no more data, send complete.
                if (contexts.length == 0) {
                    response.send({ complete: true });
                    return;
                }

                contexts = contexts.map(context => context.content);
                response.send({ contexts });
            })
            .catch(e => {
                response.sendStatus(500);
                error_thrower(e);
            });
    }
};




module.exports = {
    database_handler
};
