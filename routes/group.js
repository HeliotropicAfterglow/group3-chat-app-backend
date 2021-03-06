const express = require('express')
const router = express.Router()

const { Group, Message, LastVisit } = require('../models/Group')

const User = require('../models/User')

const { authenticateToken, authorizeClient } = require('../AuthMiddleware')
const { default: mongoose } = require('mongoose')
const Image = require('../models/Image')
const res = require('express/lib/response')

router.get('/get_group_data/:groupId', authenticateToken, async (req, res) => {
  try {
    if (!authorizeClient(req.query.currentUserId, req.headers['authorization'])) return res.sendStatus(401)
    Group.findOne({ _id: req.params.groupId })
      .select('createdAt creator moderators participants title updatedAt image')
      .populate('moderators creator', '_id username status image')
      .populate('image')
      .populate({ path: 'participants', select: '_id username image status', populate: { path: 'image', select: 'imageBuffer imageType' } })
      .exec()
      .then(result => {
        res.status(200).json(result)
      })
      .catch((err) => {
        console.log(err);
        res.status(500).json({
          error: err,
        });
      });
  } catch (error) {
    console.log(error)
    return res.sendStatus(500)
  }
})

// Get messages sent to a group
router.get('/get_messages/:groupId', authenticateToken, async (req, res) => {
  try {
    if (!authorizeClient(req.query.currentUserId, req.headers['authorization'])) return res.sendStatus(401)
    const isParticipant = await Group.findById(req.params.groupId).select('participants').exec();
    if (!isParticipant?.participants.includes(req.query.currentUserId)) return res.status(401).json({ permissions: 'You are not a participant of this group.' })
    let visit = await LastVisit.findOne({ user: req.query.currentUserId, group: req.params.groupId }).exec()
    if (visit === null) {
      visit = { lastActiveAt: new Date() }
    }
    Group.findOne({ _id: req.params.groupId })
      .populate('participants moderators creator', '_id username status image')
      .populate({ path: 'messages', options: { sort: { createdAt: -1 }, skip: 0 }, match: { 'createdAt': { $gt: visit.lastActiveAt } }, populate: { path: 'sender images', select: '_id username status image imageBuffer imageType' } })
      .populate({ path: 'messages', options: { sort: { createdAt: -1 }, skip: 0 }, match: { 'createdAt': { $gt: visit.lastActiveAt } }, populate: { path: 'reply', select: '_id body', populate: { path: 'sender', select: '_id username' } } })
      .limit(1)
      .exec()
      .then(result => {
        res.status(200).json(result)
      })
      .catch((err) => {
        console.log(err);
        res.status(500).json({
          error: err,
        });
      });
  } catch (error) {
    console.log(error)
    return res.sendStatus(500)
  }
})

router.get('/get_more_messages/:groupId', authenticateToken, async (req, res) => {
  try {
    if (!authorizeClient(req.query.currentUserId, req.headers['authorization'])) return res.sendStatus(401)
    const isParticipant = await Group.findById(req.params.groupId).select('participants').exec();
    if (!isParticipant?.participants.includes(req.query.currentUserId)) return res.status(401).json({ permissions: 'You are not a participant of this group.' })
    Group.findOne({ _id: req.params.groupId })
      .select('messages')
      .populate({ path: 'messages', options: { sort: { createdAt: -1 }, skip: req.query.skip, limit: 20 }, populate: { path: 'sender images', select: '_id username status image imageBuffer imageType' } })
      .populate({ path: 'messages', options: { sort: { createdAt: -1 }, skip: req.query.skip, limit: 20 }, populate: { path: 'reply', select: '_id body', populate: { path: 'sender', select: '_id username' } } })
      .limit(1)
      .exec()
      .then(result => {
        res.status(200).json(result)
      })
      .catch((err) => {
        console.log(err);
        res.status(500).json({
          error: err,
        });
      });
  } catch (error) {
    console.log(error)
    return res.sendStatus(500)
  }
})

router.post('/visit', authenticateToken, async (req, res) => {
  if (!authorizeClient(req.body.currentUserId, req.headers['authorization'])) return res.sendStatus(401)
  const isParticipant = await Group.findById(req.body.currentGroupId).select('participants').exec();
  if (!isParticipant?.participants.includes(req.body.currentUserId)) return res.status(401).json({ permissions: 'You are not a participant of this group.' })
  LastVisit.findOne({ user: req.body.currentUserId, group: req.body.currentGroupId })
    .exec()
    .then((result) => {
      if (result) {
        LastVisit.findOneAndUpdate({ _id: result._id }, { lastActiveAt: new Date() })
          .exec()
          .then((result) => {
            res.status(200).json({
              message: "Last time active updated",
              group: result._id,
              user: req.body.currentUserId,
              lastActiveAt: result.lastActiveAt
            })
          })
      } else {
        const lastVisit = new LastVisit({
          group: req.body.currentGroupId,
          user: req.body.currentUserId,
          lastActiveAt: new Date(),
        })
        lastVisit
          .save()
          .then((result) => {
            res.status(201).json({
              message: "Last time active object created",
              result
            })
          })
      }

    }).catch((error) => {
      console.log(error)
      return res.sendStatus(500)
    })
})

router.get('/get_visits/:currentGroupId/:currentUserId', authenticateToken, async (req, res) => {
  console.log(req.params.currentUserId)
  if (!authorizeClient(req.params.currentUserId, req.headers['authorization'])) return res.sendStatus(401)
  LastVisit.find({ group: req.params.currentGroupId })
    .populate({ path: 'user', select: '_id username status image', populate: { path: 'image', select: '_id imageBuffer imageType' } })
    .exec()
    .then((result) => {
      res.status(200).json(result);
    })
})

// Create a message used for group messaging as well.
router.post('/create_message/:groupId', authenticateToken, async (req, res) => {
  if (!authorizeClient(req.body.sender, req.headers['authorization'])) return res.sendStatus(401)
  let imageIds = [];
  for (let i = 0; i < req.body.images.length; i++) {
    const image = new Image({
      imageType: req.body.images[i].imageType,
      imageBuffer: req.body.images[i].imageBuffer
    })
    const savedImage = await image.save()
    imageIds.push(savedImage._id.toHexString())
  }
  const message = new Message({
    _id: mongoose.Types.ObjectId(),
    body: req.body.body,
    type: req.body.type,
    images: imageIds,
    reply: req.body.reply,
    sender: req.body.sender
  });
  message
    .save()
    .then((result) => {
      res.status(200).json({
        message: "Created a message successfully",
        result
      })
      addMessageToGroup(result._id, req.params.groupId)
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({
        error: err,
      });
    });
})

async function addMessageToGroup(message, params) {
  try {
    const result = await Group.findOneAndUpdate(
      {
        _id: params
      },
      {
        $push: {
          messages: message
        }
      }
    )
    //console.log(result)
  } catch (error) {
    console.log(error)
  }
}

// Make sure you cannot delete the creator or other moderators
router.post('/add_to_group', authenticateToken, async (req, res) => {
  try {
    if (!authorizeClient(req.body.currentUserId, req.headers['authorization'])) return res.sendStatus(401)
    const isModerator = await Group.findById(req.body.groupId).select('moderators creator').exec();
    if (!isModerator.moderators.includes(req.body.currentUserId)) return res.status(401).json({ permissions: 'You do not have moderator status in this group.' })
    // Checks if the user is the creator if so he can delete moderators as well
    if (!(isModerator.creator.toHexString() === req.body.currentUserId)) {
      if (isModerator.moderators.includes(req.body.companionUserId)) return res.status(401).json({ permissions: 'You do not have the permission to remove another moderator.' })
    }
    const group = await Group.findById(req.body.groupId);
    if (!group.participants.includes(req.body.companionUserId)) {
      await group.updateOne({ $push: { participants: req.body.companionUserId } });
      await addUserToGroup(req.body.companionUserId, req.body.groupId);
      res.status(201).json({ success: "Participant was added" });
    } else {
      await group.updateOne({ $pull: { participants: req.body.companionUserId, moderators: req.body.companionUserId } });
      await removeUserFromGroup(req.body.companionUserId, req.body.groupId);
      res.status(200).json({ success: "Participant was deleted" });
    }
  } catch (error) {
    console.log(error)
    return res.sendStatus(500)
  }
})

router.post('/admin', authenticateToken, async (req, res) => {
  try {
    if (!authorizeClient(req.body.currentUserId, req.headers['authorization'])) return res.sendStatus(401)
    const isCreator = await Group.findById(req.body.groupId).select('creator').exec();
    if (!(isCreator.creator.toHexString() === req.body.currentUserId)) return res.status(401).json({ permissions: 'You do not have creator status in this group.' })
    if (isCreator.creator.toHexString() === req.body.companionUserId) return res.status(401).json({ permissions: 'You cannot remove creators permissions.' })
    const group = await Group.findById(req.body.groupId);
    if (!group.moderators.includes(req.body.companionUserId)) {
      await group.updateOne({ $push: { moderators: req.body.companionUserId } });
      await addUserToGroup(req.body.companionUserId, req.body.groupId);
      res.status(201).json({ success: "Participant was given admin permissions" });
    } else {
      await group.updateOne({ $pull: { moderators: req.body.companionUserId } });
      await removeUserFromGroup(req.body.companionUserId, req.body.groupId);
      res.status(200).json({ success: "Participants admin permissions were removed" });
    }
  } catch (error) {
    console.log(error)
    return res.sendStatus(500)
  }
})

// Create a group with the creator as the creator and a moderator 
router.post('/create_group', authenticateToken, async (req, res) => {
  if (!authorizeClient(req.body.currentUserId, req.headers['authorization'])) return res.sendStatus(401)
  const group = new Group({
    _id: mongoose.Types.ObjectId(),
    title: req.body.title,
    participants: req.body.participants,
    creator: req.body.currentUserId,
    moderators: req.body.moderators,
  });

  group
    .save()
    .then((result) => {
      // This goes through all the participants and adds them to the group on the user side as well.
      req.body.participants.map(user => addUserToGroup(user, result._id))
      if (req.body?.imageBuffer !== undefined) {
        addImageToGroup(req, result._id);
      }
      res.status(200).json({
        message: "Created group successfully",
        createdGroup: {
          _id: result._id,
          title: result.title,
          creator: result.creator
        }
      })
    })
    .catch((err) => {
      console.log(err);
      res.status(500).json({
        error: err,
      });
    });
})

router.delete('/delete_message', authenticateToken, async (req, res) => {
  try {
    if (!authorizeClient(req.body.currentUserId, req.headers['authorization'])) return res.sendStatus(401)
    const isSender = await Message.findById(req.body.messageId).populate({ path: 'sender', select: '_id images' }).exec()
    if (!(isSender.sender._id.toHexString() === req.body.currentUserId)) return res.status(401).json({ permissions: 'You are not the sender of this message.' })
    if (isSender.images.length > 0) {
      await Image.deleteMany({ _id: { $in: isSender.images } }).exec()
    }
    await Message.findByIdAndUpdate(req.body.messageId, {
      $set: {
        body: 'This message has been deleted',
        type: 'Deleted',
        images: []
      }
    }, {
      returnDocument: 'after'
    })
      .exec()
      .then((response) => {
        res.status(200).json({ deleted: 'The message has been deleted.', response })
      })
  } catch (error) {
    console.log(error)
    return res.sendStatus(500)
  }
})

router.delete('/delete_group', authenticateToken, async (req, res) => {
  try {
    if (!authorizeClient(req.body.currentUserId, req.headers['authorization'])) return res.sendStatus(401)
    const isCreator = await Group.findById(req.body.currentGroupId).select('creator participants messages image').populate('messages').exec();
    if (!(isCreator.creator.toHexString() === req.body.currentUserId)) return res.status(401).json({ permissions: 'You do not have creator status in this group.' })
    if (isCreator.participants.length > 0) {
      for (let u = 0; u < isCreator.participants.length; u++) {
        removeUserFromGroup(isCreator.participants[u], req.body.currentGroupId)
      }
    }
    let msgs = [];
    let imgs = [];
    if (isCreator.messages.length > 0) {
      for (let i = 0; i < isCreator.messages.length; i++) {
        msgs.push(isCreator.messages[i]._id)
        for (let x = 0; x < isCreator.messages[i].images.length; x++) {
          imgs.push(isCreator.messages[i].images[x])
        }
      }
    }
    await Message.deleteMany({ _id: { $in: msgs } }).exec()
    await Image.deleteMany({ _id: { $in: imgs } }).exec()
    await Image.deleteOne({ _id: isCreator.image }).exec()
    await Group.deleteOne({ _id: req.body.currentGroupId })
      .exec()
      .then((response) => {
        console.log(response)
        res.status(200).json({ deleted: 'The group has been deleted.', response })
      })
  } catch (error) {
    console.log(error)
    return res.sendStatus(500)
  }
})

router.post('/set_group_image', authenticateToken, async (req, res) => {
  try {
    if (!authorizeClient(req.body.currentUserId, req.headers['authorization'])) return res.sendStatus(401)
    const isModerator = await Group.findById(req.body.currentGroupId).select('moderators').exec();
    if (!isModerator.moderators.includes(req.body.currentUserId)) return res.status(401).json({ permissions: 'You do not have moderator status in this group.' })
    const checkIfImageExists = await Group.findById(req.body.currentGroupId, 'image').exec()
    if (checkIfImageExists != null) {
      const image = await Image.findById(checkIfImageExists.image).exec()
      if (image !== null) {
        image.imageType = req.body.imageType,
          image.imageBuffer = req.body.imageBuffer
        const savedImage = await image.save()
        return res.status(200).json({ success: "Image changed." })
      } else {
        return res.sendStatus(304)
      }
    } else {
      const result = await addImageToGroup(req)

      if (result && result.image) {
        return res.status(200).json({ success: "Image changed." })
      } else {
        return res.sendStatus(500)
      }
    }
  } catch (error) {
    console.log(error)
    return res.sendStatus(500)
  }
})

async function addImageToGroup(req, _id) {
  try {
    const groupId = req.body.currentGroupId || _id;
    const image = new Image({
      imageType: req.body.imageType,
      imageBuffer: req.body.imageBuffer
    })
    const savedImage = await image.save()
    const result = await Group.findByIdAndUpdate(groupId, {
      $set: {
        image: savedImage._id
      }
    }, {
      returnDocument: 'after'
    }).exec()

    return result;

  } catch (error) {
    console.log(error)
  }
}

async function addUserToGroup(userId, groupId) {
  try {
    const result = await User.findOneAndUpdate(
      {
        _id: userId
      },
      {
        $push: {
          groups: groupId
        }
      }
    )
  } catch (error) {
    console.log(error)
  }
}

async function removeUserFromGroup(userId, groupId) {
  try {
    const result = await User.findOneAndUpdate(
      {
        _id: userId
      },
      {
        $pull: {
          groups: groupId
        }
      }
    )
  } catch (error) {
    console.log(error)
  }
}

module.exports = router