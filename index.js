const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const express = require('express')
const cors = require('cors')
const app = express()
const port = 3000
require('dotenv').config();


// middleware
app.use(express.json());
app.use(cors());

const uri = process.env.MONGO_URI;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        await client.connect(); // ✅ IMPORTANT

        const db = client.db('dokkhoDB');
        const usersCollection = db.collection("users");
        const providersCollection = db.collection("providers");

        app.patch("/users/:uid/customer-role", async (req, res) => {
            try {
                const { uid } = req.params;
                const { phoneNumber } = req.body;

                if (!uid) {
                    return res.status(400).json({ success: false, message: "UID missing" });
                }

                const updateDoc = {
                    $set: {
                        "roles.customer": true,
                    },
                    $setOnInsert: {
                        uid,
                        createdAt: new Date(),
                    },
                };

                // ✅ save phoneNumber if provided
                if (phoneNumber) {
                    updateDoc.$set.phoneNumber = phoneNumber;
                }

                const result = await usersCollection.updateOne(
                    { uid },
                    updateDoc,
                    { upsert: true }
                );

                res.status(200).json({ success: true });
            } catch (error) {
                console.error("❌ customer-role ERROR:", error);
                res.status(500).json({
                    success: false,
                    message: "Customer role update failed",
                    error: error.message,
                });
            }
        });


        app.post("/providers", async (req, res) => {
            try {
                const { user, providerData } = req.body;

                // ✅ basic validation
                if (!user?.uid) {
                    return res.status(400).send({ message: "Invalid user data" });
                }

                // 1️⃣ Find or create user
                let existingUser = await usersCollection.findOne({ uid: user.uid });

                if (!existingUser) {
                    const userDoc = {
                        uid: user.uid,
                        phoneNumber: user.phoneNumber,
                        metadata: user.metadata,
                        reloadUserInfo: user.reloadUserInfo,
                        roles: { customer: true },
                        createdAt: new Date(),
                    };

                    const result = await usersCollection.insertOne(userDoc);
                    existingUser = { _id: result.insertedId };
                }

                // 2️⃣ Prevent duplicate provider
                const alreadyProvider = await providersCollection.findOne({
                    userId: existingUser._id,
                });

                if (alreadyProvider) {
                    return res.send({
                        success: true,
                        providerId: alreadyProvider._id,
                        message: "Provider already exists",
                    });
                }

                // 3️⃣ Create provider profile
                const providerDoc = {
                    userId: existingUser._id,
                    name: providerData.name,
                    service: providerData.service,
                    location: providerData.location,
                    areaOnly: providerData.areaOnly,
                    contact: providerData.contact,
                    availability: true,
                    createdAt: new Date(),
                };

                const providerResult = await providersCollection.insertOne(providerDoc);
                await usersCollection.updateOne(
                    { _id: existingUser._id },
                    { $set: { "roles.provider": true } }
                );
                res.send({
                    success: true,
                    providerId: providerResult.insertedId,
                });

            } catch (error) {
                console.error(error);
                res.status(500).send({ message: "Failed to save provider" });
            }
        });
        app.get("/providers/by-uid/:uid", async (req, res) => {
            try {
                const { uid } = req.params;

                const user = await usersCollection.findOne({ uid });
                if (!user) {
                    return res.status(200).send({
                        exists: false,
                        provider: null,
                    });
                }

                const provider = await providersCollection.findOne({
                    userId: user._id,
                });

                if (!provider) {
                    return res.status(200).send({
                        exists: false,
                        provider: null,
                    });
                }

                res.status(200).send({
                    exists: true,
                    provider,
                });
            } catch (error) {
                console.error(error);
                res.status(500).send({ message: "Failed to fetch provider" });
            }
        });


        app.patch("/providers/:id/availability", async (req, res) => {
            try {
                const { id } = req.params;
                const { availability } = req.body;

                await providersCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: { availability } }
                );

                res.send({ success: true, availability });
            } catch (error) {
                console.error(error);
                res.status(500).send({ message: "Failed to update availability" });
            }
        });
        app.post("/logout", async (req, res) => {
            try {
                // future: token blacklist / audit log
                res.send({
                    success: true,
                    message: "Logged out successfully",
                });
            } catch (error) {
                res.status(500).send({
                    success: false,
                    message: "Logout failed",
                });
            }
        });



        await client.db("admin").command({ ping: 1 });
        console.log("MongoDB connected successfully");

    } catch (err) {
        console.error(err);
    }
}


run().catch(console.dir);
app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})
