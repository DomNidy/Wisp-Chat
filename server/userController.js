require('dotenv').config();
const bcrypt = require('bcrypt');
const { getClientAndDB, dbName } = require('./database.js')
const { randomUUID } = require('crypto');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = process.env.MONGO_URI;

async function registerUser(email, password) {
    let client, db;
    try {
        // Get client
        const { client, db } = await getClientAndDB(email);

        // Hash password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Check to see if account already exists
        const accountResult = await db.collection('users').findOne({ email: email });
        if (accountResult != null) {
            return [false, `${email} already has an account`];
        }

        // Create user object
        const newUser = {
            email: email,
            password: hashedPassword
        };

        // Insert into users collection
        const result = await db.collection('users').insertOne(newUser);

        console.log('User registered successfully: ', result.insertedId);
        return [true, result.insertedId];
    } catch (err) {
        console.log("Error registering user:", err);
    } finally {
        // If client exists, close it
        if (client) {
            console.log("Closing client");
            await client.close();
        }
    }
}

async function loginUser(email, password) {
    let client;
    try {
        // Get client
        const { client, db } = await getClientAndDB(email);

        // Reference to users collection
        const usersCollection = await db.collection('users');

        const user = await usersCollection.findOne({ email: email });

        // If we find the email within the database
        if (user) {
            const result = await new Promise((resolve, reject) => {
                bcrypt.compare(password, user.password, function (err, result) {
                    if (err) {
                        reject(err);
                    }
                    else {
                        resolve(result);
                    }
                });
            });

            if (result === true) {
                return true;
            }
            else {
                return `User ${email} has failed to login, wrong pass`;
            }
        }
        else {
            return `User ${email} does not exist!`;
        }

    } finally {
        if (client) {
            console.log("Closing client");
            await client.close();
        }
    }
}

// Generates a session Token and then creates and inserts a sessionToken object on the database
async function generateSessionToken(email) {
    let client, db;
    try {
        // Get past tokens the user that are still stored in the db
        const needsNewToken = await retrieveUserPastSessionTokens(email)
            .then(
                async (pastTokens) => {
                    // If we have past tokens to check for expired and duplicates
                    if (pastTokens !== false) {
                        return await removeExpiredAndDuplicateTokens(pastTokens, email);
                    }
                    return true;
                });

        // If needsNewToken is explicity equal to true before type-conversion comparisson is done 
        // We do this because needsNewToken can either be true or the active session token
        // If we were to do only "if(needsNewToken == true)" this condition would always run by default since the session token string would evaluate to true

        if (needsNewToken !== true) {
            console.log(`User ${email} already has an active session token`)
            return needsNewToken;
        }
        else {
            console.log(`User ${email} needs a new session token, generating one...`)

            // Get client
            const { client, db } = await getClientAndDB(email);
            // Reference to sessions collection
            const sessionsCollection = await db.collection('sessions');

            // Generates the actual uuid assosciated with the sessionToken (the string of numbers and letters)
            const tokenID = randomUUID();
            // Token expires 18000000 miliseconds from now (5 hours)
            const expirationTime = Date.now() + 18000000;
            // Create sessionToken object to be inserted in database
            const sessionToken = ({
                email: email,
                tokenID: tokenID,
                expires: expirationTime
            });
            const insertResult = await sessionsCollection.insertOne(sessionToken);
            console.log("Inserted a session token:", insertResult);
            return tokenID;
        }

    }
    catch (err) {
        console.log(err);
    }
    finally {
        if (client) {
            console.log("Closing client");
            await client.close();
        }
    }
}

// Checks database to see if the user has multiple tokens already
// If the user does, return an array of their past session tokens, this is used so we can cull expired/duplicate tokens
// If the user does not have any previous tokens, return false
async function retrieveUserPastSessionTokens(email) {
    let client, db;
    try {
        const { client, db } = await getClientAndDB(email);

        // Reference to sessions collection
        const sessionsCollection = await db.collection('sessions');

        // Array of sessionToken objects the user previously had
        const usersPreviousTokens = (await sessionsCollection.find({ email: email })).toArray();

        // If we do not have any previous tokens, return false
        if (await usersPreviousTokens == false) {
            return false;
        }

        return await usersPreviousTokens;
    }
    catch (err) {
        console.log(err);
    }
    finally {
        if (client) {
            console.log("Closing client");
            await client.close();
        }
    }
}

// Given an array of tokens from a single user, remove tokens that are expired, or if the user has multiple tokens active which are not expired- 
// remove all such that only one active token remains.
// Returns true if user needs a new token, returns the active token if false
async function removeExpiredAndDuplicateTokens(tokenArray, email) {
    let client, db;
    try {
        // Get client
        const { client, db } = await getClientAndDB(email);

        // Reference to sessions collection
        const sessionsCollection = await db.collection('sessions');

        // If the user needs a new token to be generated
        let needsNewToken = true;
        // If the user has non-expired tokens, we will return this one
        let sessionToken;

        // We separate these tokens into separate arrays because we will keep the final item in the nonExpiredTokens to be removed
        // The user will continue using this token which hasnt expired yet, the other ones will be removed

        // Tokens that have not reached their expiration time
        const nonExpiredTokensToBeRemoved = []
        // Tokens that have expired
        const expiredTokensToBeRemoved = []

        // If an element is not expired, add it to the array of nonExpired tokens
        // If an element is expired, add it to the array of expired tokens
        tokenArray.forEach(element => {
            if (element.expires <= Date.now()) {
                expiredTokensToBeRemoved.push(element._id);
                console.log(JSON.stringify(element) + " is expired")
            }
            else {
                nonExpiredTokensToBeRemoved.push(element._id);
            }
        });

        // If there are any tokens in this array that means the user has a non-expired token already and we wont need to generate them a new one
        if (nonExpiredTokensToBeRemoved.length >= 1) {
            needsNewToken = false;
            sessionToken = await sessionsCollection.findOne({ _id: nonExpiredTokensToBeRemoved.pop() });
        }

        // Remove the nonExpired duplicate tokens
        const idsToDelete = nonExpiredTokensToBeRemoved.concat(expiredTokensToBeRemoved).map(id => new ObjectId(id));
        const result = await sessionsCollection.deleteMany({ _id: { $in: idsToDelete } });

        // If we delete any tokens, print out how many were deleted
        if (result.deletedCount) {
            console.log(`Removed ${result.deletedCount} duplicate and or expired session token(s).`);
        }

        if (!needsNewToken) {
            return sessionToken.tokenID;
        }
        return true;
    }
    catch (err) {
        console.log(err);
    }
    finally {
        if (client) {
            console.log("Closing client");
            await client.close();
        }
    }
}

// When the user requests content needing a session token, this function will ensure their session token is valid & has not expired
async function isValidSessionToken(tokenID, email) {
    let client, db;
    try {
        // Get client
        const { client, db } = await getClientAndDB(email);
        // Get sessions collection
        const sessionsCollection = await db.collection('sessions');

        // Attempt to find the tokenID in the collection
        const tokenResult = await sessionsCollection.findOne({ tokenID: tokenID });

        // If the token does not exist in the database, return false
        if (!tokenResult) {
            console.log(`tokenID: '${tokenID}' does not exist.`)
            return false;
        }

        // If the tokens expiry time is greater than the current time, return true, if not, return false
        return tokenResult.expires > Date.now();
    }
    catch (err) {
        console.log(err);
        return false;
    }
}

module.exports = { registerUser, loginUser, generateSessionToken, isValidSessionToken };