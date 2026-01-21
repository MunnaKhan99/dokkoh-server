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
                        role: "provider",
                        createdAt: new Date(),
                    };

                    const userResult = await usersCollection.insertOne(userDoc);
                    existingUser = { _id: userResult.insertedId };
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

                res.send({
                    success: true,
                    providerId: providerResult.insertedId,
                });

            } catch (error) {
                console.error(error);
                res.status(500).send({ message: "Failed to save provider" });
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
