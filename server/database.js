require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');
const uri = process.env.MONGO_URI;
const dbName = "ChatAppDb";

// This stores the active clients each user is using
const cachedClients = {};


// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const clientDefault = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

// If the user has no active client in cachedClients, create a new client, insert it into cachedClients, then return the reference to the client and db
async function getClientAndDB(emailOrToken) {
    if (!cachedClients[emailOrToken]) {
        try {
            console.log(`Creating new client connection for ${emailOrToken}`);
            const client = await clientDefault.connect();
            const db = client.db(dbName);
            cachedClients[emailOrToken] = { client, db };
        }
        catch(err) {
            console.log(`Could not create new client connection for ${emailOrToken}`);
            return false;
        }
        
    }
    return cachedClients[emailOrToken];
}


module.exports = {
    getClientAndDB,
    dbName,
};



