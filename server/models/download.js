const mongoose = require("mongoose");

const downloadSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },

    videoId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Video",
        required: true
    },

    userPlan: {
        type: String,
        required: true
    },

    videoTitle: {
        type: String,
        required: true
    },

    downloadedAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model("Download", downloadSchema);