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
    // try {

    //     const gymSchedule = client.db('gymSchedule').collection('schedule')
    //     app.post('/schedule', async (req, res) => {
    //         const data = req.body;
    //         const result = await gymSchedule.insertOne(data);
    //         console.log(req.body);
    //         res.send(result)
    //     })

    //     app.get('/schedule', async (req, res) => {
    //         const { searchParams } = req.query;
    //         let query = {}
    //         if (searchParams) {
    //             query = { title: { $regex: searchParams, $options: "i" } };
    //         }
    //         const result = await gymSchedule.find(query).toArray();
    //         res.send(result);
    //     })

    //     app.delete("/schedule/:id", async (req, res) => {
    //         const id = req.params.id;
    //         const query = { _id: new ObjectId(id) }
    //         const result = await gymSchedule.deleteOne(query);
    //         res.send(result)
    //     })
    //     app.get("/schedule/:id", async (req, res) => {
    //         const id = req.params.id;
    //         const query = { _id: new ObjectId(id) }
    //         const result = await gymSchedule.findOne(query);
    //         res.send(result)
    //     })
    //     app.put("/schedule/:id", async (req, res) => {
    //         const id = req.params.id;
    //         const { title, date, day, time } = req.body;
    //         const query = { _id: new ObjectId(id) };
    //         const updatedData = {
    //             $set: {
    //                 title,
    //                 date,
    //                 day,
    //                 time
    //             }
    //         }
    //         const result = await gymSchedule.updateOne(query, updatedData);
    //         res.send(result)
    //     })

    //     await client.db("admin").command({ ping: 1 });
    //     console.log("Pinged your deployment. You successfully connected to MongoDB!");
    // } finally {

    // }
}

run().catch(console.dir);
app.get('/', (req, res) => {
    res.send('Hello World!')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})
