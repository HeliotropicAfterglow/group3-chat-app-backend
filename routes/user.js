/* 
  User account routes:
  - edit (status, username)
  - delete account
*/


const express = require('express')
const router = express.Router()

const User = require("../models/User")

const { sendConfirmationMail } = require('../mailer')

const { authenticateToken, authorizeClient } = require('../AuthMiddleware')
const bcrypt = require('bcrypt')
const randomstring = require('randomstring')
const Image = require('../models/Image')

router.post('/set_status', authenticateToken, async (req, res) => {
  try {
    if (!authorizeClient(req.body.currentUserId, req.headers['authorization'])) return res.sendStatus(401)

    const user = await User.findById(req.body.currentUserId);
    const result = await user.updateOne({ $set: { status: req.body.newStatus } });
    if (result.modifiedCount == 1) {
      return res.status(200).json({ newStatus: req.body.newStatus })
    } else {
      return res.sendStatus(204)
    }
  } catch (error) {
    console.log(error)
    return res.sendStatus(500)
  }
})

router.post('/set_username', authenticateToken, async (req, res) => {
  try {
    if (!authorizeClient(req.body.currentUserId, req.headers['authorization'])) return res.sendStatus(401)

    const user = await User.findById(req.body.currentUserId)
    const result = await user.updateOne({ $set: { username: req.body.newUsername } })
    if (result.modifiedCount == 1) {
      return res.status(200).json({ newUsername: req.body.newUsername })
    } else {
      return res.sendStatus(204)
    }
  } catch (error) {
    console.log(error)
    return res.sendStatus(500)
  }
})

router.post('/set_email', authenticateToken, async (req, res) => {
  try {
    if (!authorizeClient(req.body.currentUserId, req.headers['authorization'])) return res.sendStatus(401)


    const confirmationToken = randomstring.generate({
      length: 30,
      charset: 'alphanumeric'
    })
    const confirmationLink = `https://api-group3-chat-app.herokuapp.com/auth/confirmation/${req.body.currentUserId}/${confirmationToken}`

    const result = await User.findByIdAndUpdate(req.body.currentUserId, {
      $set: {
        unconfirmedEmail: req.body.newEmail,
        confirmationToken: confirmationToken,
        confirmationSentAt: Date.now()
      }
    }, {
      returnDocument: 'after'
    }).exec()
    console.log(result)
    const isSended = sendConfirmationMail(req.body.newEmail, 'eng', confirmationLink)
    if (isSended) {
      return res.status(200).json({ success: `Confirm your account via link sent to your email.` })
    } else {
      return res.sendStatus(204)
    }

  } catch (error) {
    console.log(error)
    return res.sendStatus(500)
  }
})

router.post('/set_password', authenticateToken, async (req, res) => {
  try {
    if (!authorizeClient(req.body.currentUserId, req.headers['authorization'])) return res.sendStatus(401)

    const user = await User.findById(req.body.currentUserId)

    if (!await bcrypt.compare(req.body.currentPassword, user.password)) {
      return res.status(401).json({ error: "Invalid current password!" })
    }

    const hashedPassword = await bcrypt.hash(req.body.newPassword, 10)
    user.password = hashedPassword
    const savedUser = await user.save()
    return res.status(200).json({ success: "Password changed." })
  } catch (error) {
    console.log(error)
    return res.sendStatus(500)
  }
})

router.post('/reset_password', async (req, res) => {
  try {


    const user = await User.findOne({ email: req.body.email })

    if (user.passwordResetCode != req.body.passwordResetCode) return res.status(401).json({ error: 'Invalid code!' })

    const hashedPassword = await bcrypt.hash(req.body.newPassword, 10)
    user.password = hashedPassword
    user.passwordResetCode = ''
    const savedUser = await user.save()
    return res.status(200).json({ success: "Password changed." })
  } catch (error) {
    console.log(error)
    return res.sendStatus(500)
  }
})

router.post('/set_image', authenticateToken, async (req, res) => {
  try {
    if (!authorizeClient(req.body.currentUserId, req.headers['authorization'])) return res.sendStatus(401)

    const checkIfImageExists = await User.findById(req.body.currentUserId, 'image').exec()
    if (checkIfImageExists.image != null) {
      const image = await Image.findById(checkIfImageExists.image).exec()
      if (image != null) {
        image.imageType = req.body.imageType,
          image.imageBuffer = req.body.imageBuffer
        const savedImage = await image.save()
        return res.status(200).json({ success: "Image changed." })
      } else {
        return res.sendStatus(304)
      }
    } else {
      const image = new Image({
        imageType: req.body.imageType,
        imageBuffer: req.body.imageBuffer
      })
      const savedImage = await image.save()
      const result = await User.findByIdAndUpdate(req.body.currentUserId, {
        $set: {
          image: savedImage._id
        }
      }, {
        returnDocument: 'after'
      }).exec()

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

router.delete('/delete_image', authenticateToken, async (req, res) => {
  try {
    console.log(res.locals.userId)

    const checkIfImageExists = await User.findById(res.locals.userId, 'image').exec()
    if (checkIfImageExists.image == null) return res.sendStatus(304)

    const imageToDelete = await Image.findById(checkIfImageExists.image).exec()

    const result = await imageToDelete.remove()
    const user = await User.findOneAndUpdate({ image: checkIfImageExists.image }, {
      $set: {
        image: null
      }
    }, {
      returnDocument: 'after'
    }).exec()

    return res.status(200).json({ success: "Image Deleted!" })
  } catch (error) {
    console.log(error)
    return res.sendStatus(500)
  }
})

// Need to be changed later
router.delete('/delete_account', authenticateToken, async (req, res) => {
  try {
    if (!authorizeClient(req.body.currentUserId, req.headers['authorization'])) return res.sendStatus(401)

    /* const result = await User.deleteOne({ "_id": req.body.currentUserId })
    console.log(result)
    if (result.deletedCount == 1) {
      return res.sendStatus(200)
    } else {
      return res.sendStatus(204)
    } */

    const userToDelete = await User.findById(req.body.currentUserId).exec()

    const imageToDelete = await Image.findById(userToDelete.image).exec()
    if (imageToDelete != null) {
      const result = await imageToDelete.remove()
    }

    userToDelete.email = ''
    userToDelete.username = 'Deleted'
    userToDelete.image = null
    userToDelete.unconfirmedEmail = ''
    userToDelete.status = ''
    userToDelete.password = ''
    userToDelete.tokens = []
    userToDelete.confirmationToken = ''
    userToDelete.passwordResetToken = ''
    const deletedUser = await userToDelete.save()
    return res.status(200).json({ success: "Account successfully deleted!" })

  } catch (error) {
    console.log(error)
    return res.sendStatus(500)
  }
})

// Add user connections to groups so we can get the group information (MAY BE CHANGED LATER SINCE I DONT THINK ITS A GOOD IMPLEMETION? BUT I COULDNT THINK OF A ANOTHER WAY TO DO IT)
router.post('/add_group', authenticateToken, async (req, res) => {
  try {
    if (!authorizeClient(req.body.currentUserId, req.headers['authorization'])) return res.sendStatus(401)
    const user = await User.findById(req.body.currentUserId);
    if (!user.groups.includes(req.body.group)) {
      await user.updateOne({ $push: { groups: req.body.group } });
      res.status(201).json({ success: "Connection to group added" });
    } else {
      await user.updateOne({ $pull: { groups: req.body.group } });
      res.status(200).json({ success: "Connection to group deleted" });
    }
  } catch (error) {
    console.log(error)
    return res.sendStatus(500)
  }
})

// Get user data for groups and contacts
router.get('/get_user/:currentUserId', authenticateToken, async (req, res) => {
  try {
    if (!authorizeClient(req.params.currentUserId, req.headers['authorization'])) return res.sendStatus(401)
    User.findOne({ _id: req.params.currentUserId })
      .select('_id username email status image')
      .populate('contacts', '_id username status image')
      .populate({ path: 'groups', select: '_id title image', populate: { path: 'image', select: 'imageBuffer imageType' } })
      .populate({ path: 'groups', select: '_id title image messages', populate: { path: 'messages', options: { sort: { createdAt: -1 }, limit: 1 }, populate: { path: 'sender', select: '_id username' } } })
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

module.exports = router