const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// --- Middleware ---
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

// Database Collections (Global Variables)
let usersCollection, providersCollection, reviewsCollection;

// MongoDB Connection Helper
let cachedClient = null;
let cachedDb = null;

async function connectDB() {
    if (cachedDb) return;

    const client = new MongoClient(process.env.MONGO_URI);
    await client.connect();

    const db = client.db("dokkhoDB");
    cachedDb = db;

    usersCollection = db.collection("users");
    providersCollection = db.collection("providers");
    reviewsCollection = db.collection("reviews");

    console.log("✅ MongoDB connected (cached)");
}


const serviceMap = {
    electrician: "ইলেক্ট্রিশিয়ান",
    plumber: "প্লাম্বার",
    tutor: "হোম টিউটর",
    others: "অন্যান্য",
};

// --- Routes ---

// Default Route
app.get('/', (req, res) => {
    res.send('Dokkho Server is running...');
});

// 1. Update/Ensure Customer Role
app.patch("/users/:uid/customer-role", async (req, res) => {
    try {
        await connectDB();
        const { uid } = req.params;
        const { phoneNumber } = req.body;

        if (!uid) return res.status(400).json({ success: false, message: "UID missing" });

        const updateDoc = {
            $set: { "roles.customer": true },
            $setOnInsert: { uid, createdAt: new Date() },
        };

        if (phoneNumber) updateDoc.$set.phoneNumber = phoneNumber;

        await usersCollection.updateOne({ uid }, updateDoc, { upsert: true });
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 2. Post Provider Data
app.post("/providers", async (req, res) => {
    try {
        await connectDB();
        const { user, providerData } = req.body;

        if (!user?.uid) return res.status(400).send({ message: "Invalid user data" });

        let existingUser = await usersCollection.findOne({ uid: user.uid });

        if (!existingUser) {
            const userDoc = {
                uid: user.uid,
                phoneNumber: user.phoneNumber,
                roles: { customer: true },
                createdAt: new Date(),
            };
            const result = await usersCollection.insertOne(userDoc);
            existingUser = { _id: result.insertedId, phoneNumber: user.phoneNumber };
        }

        const alreadyProvider = await providersCollection.findOne({ userId: existingUser._id });
        if (alreadyProvider) {
            return res.send({ success: true, providerId: alreadyProvider._id, message: "Provider already exists" });
        }

        const providerDoc = {
            userId: existingUser._id,
            name: providerData.name,
            phoneNumber: existingUser.phoneNumber,
            serviceKey: providerData.service,
            serviceName: serviceMap[providerData.service],
            locationParent: providerData.locationParent,
            locationSub: providerData.locationSub || null,
            areaOnly: providerData.areaOnly,
            contact: providerData.contact,
            experience: providerData.experience,
            rating: 0.0,
            ratingCount: 0,
            availability: true,
            createdAt: new Date(),
        };

        const providerResult = await providersCollection.insertOne(providerDoc);
        await usersCollection.updateOne({ _id: existingUser._id }, { $set: { "roles.provider": true } });

        res.send({ success: true, providerId: providerResult.insertedId });
    } catch (error) {
        res.status(500).send({ message: "Failed to save provider" });
    }
});

// 3. Fetch Providers (with Filter)
app.get("/providers", async (req, res) => {
    try {
        await connectDB();
        const { service, locationParent } = req.query;
        const filter = { availability: true };

        if (service) filter.serviceKey = service;
        if (locationParent) filter.locationParent = locationParent;

        const providers = await providersCollection.find(filter).sort({ rating: -1 }).toArray();
        res.send(providers);
    } catch (error) {
        res.status(500).send({ message: "Failed to fetch providers" });
    }
});

// 4. Fetch Provider by UID
app.get("/providers/by-uid/:uid", async (req, res) => {
    try {
        await connectDB();
        const { uid } = req.params;
        const user = await usersCollection.findOne({ uid });

        if (!user) return res.send({ exists: false, provider: null });

        const provider = await providersCollection.findOne({ userId: user._id });
        res.send({ exists: !!provider, provider });
    } catch (error) {
        res.status(500).send({ message: "Failed to fetch provider" });
    }
});

// 5. Fetch Single Provider by ID
app.get("/providers/:id", async (req, res) => {
    try {
        await connectDB();
        const { id } = req.params;
        if (!ObjectId.isValid(id)) return res.status(400).send({ message: "Invalid id" });

        const provider = await providersCollection.findOne({ _id: new ObjectId(id), availability: true });
        if (!provider) return res.status(404).send({ message: "Not found" });

        res.send(provider);
    } catch (error) {
        res.status(500).send({ message: "Error fetching details" });
    }
});

// 6. Update Availability
app.patch("/providers/:id/availability", async (req, res) => {
    try {
        await connectDB();
        const { id } = req.params;
        const { availability } = req.body;
        await providersCollection.updateOne({ _id: new ObjectId(id) }, { $set: { availability } });
        res.send({ success: true, availability });
    } catch (error) {
        res.status(500).send({ message: "Update failed" });
    }
});

// 9. review
app.post("/reviews", async (req, res) => {
    try {
        await connectDB()
        const { providerId, rating, comment, userName, userId } = req.body;
        if (!providerId || !rating || !userId) {
            return res.status(400).send({ message: "Invalid review data" });
        }

        // চেক করুন বডি খালি কিনা
        if (!providerId) {
            return res.status(400).send({ message: "Provider ID missing" });
        }

        const reviewDoc = {
            providerId: new ObjectId(providerId),
            userId,
            userName,
            rating: parseFloat(rating),
            comment,
            createdAt: new Date(),
        };
        await reviewsCollection.insertOne(reviewDoc);

        const provider = await providersCollection.findOne({ _id: new ObjectId(providerId) });

        const currentRating = provider.rating || 0;
        const currentRatingCount = provider.ratingCount || 0;

        // সঠিক ক্যালকুলেশন
        const newCount = currentRatingCount + 1;
        const newRating = ((currentRating * currentRatingCount) + parseFloat(rating)) / newCount;

        await providersCollection.updateOne(
            { _id: new ObjectId(providerId) },
            {
                $set: {
                    rating: parseFloat(newRating.toFixed(1)),
                    ratingCount: newCount
                }
            }
        );
        res.status(200).send({ success: true, message: "Review added successfully" });
    } catch (error) {
        res.status(500).send({ message: "Review submit failed", error: error.message });
    }
});

//get review:
// GET latest reviews for a provider
app.get("/reviews/provider/:id", async (req, res) => {
    try {
        await connectDB();
        const { id } = req.params;
        const limit = parseInt(req.query.limit) || 3;

        const reviews = await reviewsCollection
            .find({ providerId: new ObjectId(id) })
            .sort({ createdAt: -1 })
            .limit(limit)
            .toArray();

        res.send(reviews);
    } catch (error) {
        res.status(500).send({ message: "Failed to fetch reviews" });
    }
});


// 8. Logout
app.post("/logout", (req, res) => {
    res.send({ success: true, message: "Logged out" });
});

// --- Start Server (Local) ---
if (process.env.NODE_ENV !== 'production') {
    app.listen(port, () => {
        console.log(`Server listening on port ${port}`);
    });
}

// Export for Vercel
module.exports = app;