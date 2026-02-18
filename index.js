const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express');
const cors = require('cors');

const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const admin = require("firebase-admin");
require('dotenv').config();


const app = express();
const port = process.env.PORT || 3000;
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

// --- Middleware ---
app.use(express.json());
app.use(cookieParser());
app.use(cors({
    origin: [
        "http://localhost:5173",
        "https://dokkho-service.netlify.app"
    ],
    credentials: true
}));
const client = new MongoClient(process.env.MONGO_URI, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});


// Database Collections (Global Variables)
let usersCollection, providersCollection, reviewsCollection;

// MongoDB Connection Helper
let cachedDb = null;

const verifyToken = (req, res, next) => {
    const token = req.cookies?.token;

    if (!token) {
        return res.status(401).send({ message: 'Unauthorized access' });
    }

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send({ message: 'Forbidden access' });
        }
        // টোকেন থেকে পাওয়া UID রিকোয়েস্টে সেট করা
        req.user = decoded;
        next();
    });
};

async function connectDB() {
    if (cachedDb) return cachedDb;

    await client.connect();
    const db = client.db("dokkhoDB");
    cachedDb = db;

    usersCollection = db.collection("users");
    providersCollection = db.collection("providers");
    reviewsCollection = db.collection("reviews");

    return cachedDb;
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
app.post('/jwt', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader?.startsWith("Bearer ")) {
            return res.status(401).send({ message: "No Firebase token" });
        }

        const firebaseToken = authHeader.split(" ")[1];

        const decoded = await admin.auth().verifyIdToken(firebaseToken);

        const token = jwt.sign(
            { uid: decoded.uid },
            process.env.ACCESS_TOKEN_SECRET,
            { expiresIn: "1d" }
        );

        res.cookie("token", token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "none",
            maxAge: 24 * 60 * 60 * 1000, // 1 day
        }).send({ success: true });

    } catch (error) {
        console.error("JWT issue:", error.message);
        return res.status(401).send({ message: "Invalid or expired Firebase token" });
    }
});



// 1. Update/Ensure Customer Role
app.patch("/users/:uid/customer-role", verifyToken, async (req, res) => {
    try {
        if (req.user.uid !== req.params.uid) {
            return res.status(403).send({ message: "Forbidden" });
        }
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
app.post("/providers", verifyToken, async (req, res) => {
    try {
        await connectDB();
        const { user, providerData } = req.body;
        if (req.user.uid !== user.uid) {
            return res.status(403).send({ message: "অ্যাক্সেস ডিনাইড! এটি আপনার অ্যাকাউন্ট নয়।" });
        }

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
            contact: providerData.contact,
            experience: providerData.experience,
            profileImage: providerData.profileImage || null,
            // ✅ Step 4
            pricing: providerData.pricing,
            availabilityDays: providerData.availabilityDays,

            // ✅ Step 5
            kyc: providerData.kyc,
            kycStatus: "pending",
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

        const providers = await providersCollection.find(filter, {
            projection: {
                phoneNumber: 0,
                kyc: 0,
                contact: 0,
            }
        }).sort({ rating: -1 }).toArray();

        res.send(providers);
    } catch (error) {
        res.status(500).send({ message: "Failed to fetch providers" });
    }
});

// 4. Fetch Provider by UID
app.get("/providers/by-uid/:uid", verifyToken, async (req, res) => {
    try {
        if (req.user.uid !== req.params.uid) {
            return res.status(403).send({ message: "Forbidden" });
        }
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

        const provider = await providersCollection.findOne(
            { _id: new ObjectId(id), availability: true },
            { projection: { phoneNumber: 0, kyc: 0 } }
        );

        if (!provider) return res.status(404).send({ message: "Not found" });

        res.send(provider);
    } catch (error) {
        res.status(500).send({ message: "Error fetching details" });
    }
});

// 6. Update Availability
app.patch("/providers/:id/availability", verifyToken, async (req, res) => {
    await connectDB();
    const provider = await providersCollection.findOne({ _id: new ObjectId(req.params.id) });

    if (!provider) return res.status(404).send({ message: "Not found" });

    const user = await usersCollection.findOne({ _id: provider.userId });

    if (user.uid !== req.user.uid) {
        return res.status(403).send({ message: "Not your provider profile" });
    }

    await providersCollection.updateOne(
        { _id: provider._id },
        { $set: { availability: req.body.availability } }
    );

    res.send({ success: true });
});


// 9. review
app.post("/reviews", verifyToken, async (req, res) => {
    try {
        await connectDB();

        const { providerId, rating, comment } = req.body;
        const userUid = req.user.uid;   // ✅ JWT থেকে নেওয়া

        if (!providerId || !rating) {
            return res.status(400).send({ message: "Invalid review data" });
        }

        const user = await usersCollection.findOne({ uid: userUid });
        if (!user) return res.status(401).send({ message: "Invalid user" });

        const reviewDoc = {
            providerId: new ObjectId(providerId),
            userId: user._id,           // ✅ DB user id
            userName: user.phoneNumber || "User", // বা profile name
            rating: parseFloat(rating),
            comment,
            createdAt: new Date(),
        };

        await reviewsCollection.insertOne(reviewDoc);

        const provider = await providersCollection.findOne({ _id: new ObjectId(providerId) });

        const currentRating = provider.rating || 0;
        const currentRatingCount = provider.ratingCount || 0;

        const newCount = currentRatingCount + 1;
        const newRating = ((currentRating * currentRatingCount) + parseFloat(rating)) / newCount;

        await providersCollection.updateOne(
            { _id: provider._id },
            {
                $set: {
                    rating: parseFloat(newRating.toFixed(1)),
                    ratingCount: newCount
                }
            }
        );

        res.status(200).send({ success: true });
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
        if (!ObjectId.isValid(id)) {
            return res.status(400).send({ message: "Invalid provider id" });
        }
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
app.post('/logout', (req, res) => {
    res.clearCookie('token', {
        maxAge: 0,
        secure: process.env.NODE_ENV === 'production',
        sameSite: "none"
    })
        .send({ success: true });
});

// --- Start Server (Local) ---
if (process.env.NODE_ENV !== 'production') {
    app.listen(port, () => {
        console.log(`Server listening on port ${port}`);
    });
}

// Export for Vercel
module.exports = app;