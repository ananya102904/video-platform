const mongoose = require("mongoose");
const videoSchema = new mongoose.Schema({
    title:{
        type:String,
        required:true
    },
    description:{
        type:String
    },
    videoUrl: {
    type: String,
    required: true
},

thumbnail: {
    type: String
},

category: {
    type: String
},

isPremium: {
    type: Boolean,
    default: false
},
    uploadedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
    },

    views: {
        type: Number,
        default: 0
    },
    downloads:{
        type: Number,
        default:0

    },
    downloadLimit: {
        type :Number,
        default:3

    },
    likes: {
    type: Number,
    default: 0
},

dislikes: {
    type: Number,
    default: 0
},
isPremium: {
    type: Boolean,
    default: false
}

});







 module.exports = mongoose.model("Video",videoSchema);