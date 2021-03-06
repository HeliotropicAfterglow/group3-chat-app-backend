const express = require('express')
const router = express.Router()

const jwt = require('jsonwebtoken')
const bcrypt = require('bcrypt')
const randomstring = require("randomstring")

const { sendMail, sendPasswordResetMail } = require('../mailer')

const User = require("../models/User")

// Login
router.post('/login', async (req, res) => {
  if (req.body.email == '') return res.status(401).json({"error": "Email can't be empty!"})
  const user = await User.findOne({ 'email': req.body.email }).exec()
  if (user == null) {
    return res.status(401).json({"error": "No user with that email"})
  }
  try {
    if (await bcrypt.compare(req.body.password, user.password)) {
      const userData = {
        id: user._id,        
      }
      const accessToken = jwt.sign(userData, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1000min' })  // Token is now valid for 30 min
      const filteredTokens = user.tokens.filter((_token) => {
        return jwt.verify(_token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
          if (decoded) return true
          if (err) return false          
        })
      })
      filteredTokens.push(accessToken)
      user.tokens = filteredTokens

      user.signInCount = user.signInCount + 1

      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      user.lastSignInIp = user.currentSignInIp
      user.currentSignInIp = ip

      user.lastSignInAt = user.currentSignInAt
      user.currentSignInAt = Date.now();

      const savedUser = await user.save()
      
      return res.status(200).json({ 
        accessToken: accessToken,
        user: savedUser
      })

    } else {
      return res.status(401).json({"error": "Invalid credentials"})
    }
  } catch(error) {
    console.log(error)
    return res.sendStatus(500)
  }
})

router.get('/verify_token', (req, res) => {
  try {
    const authHeader = req.headers['authorization']
    const token = authHeader && authHeader.split(' ')[1]
    if (token == null) return res.sendStatus(401)
  
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, async (err, decoded) => {
      if (err) return res.sendStatus(403)
      //res.json(decoded)
      const user = await User.findOne({ '_id': decoded.id }).exec()
      if (user == null) {
        return res.sendStatus(401)
      }
      res.status(200).json({ 
        user: user
      })
    })
  } catch(error) {
    console.log(error)
    return res.sendStatus(500)
  }
})

// Logout
router.delete('/log_out', async (req, res) => {
  try {
    const authHeader = req.headers['authorization']
    const token = authHeader && authHeader.split(' ')[1]
    if (token == null) return res.sendStatus(401)
  
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, async (err, decoded) => {
      if (err) return res.sendStatus(403)
      //
      const user = await User.findOne({ '_id': decoded.id }).exec()
      if (user == null) {
        return res.sendStatus(422)
      }
      const filteredTokens = user.tokens.filter((_token) => {
        return _token != token
      })
      user.tokens = filteredTokens
      await user.save()
      res.sendStatus(200)
    })
  } catch(error) {
    console.log(error)
    return res.sendStatus(500)
  }
})

// Register
router.post('/sign_up', async (req, res) => {
  try {
    const checkIfUsernameExists = await User.find({username: req.body.username}).exec()
    const checkIfEmailExists = await User.find({email: req.body.email}).exec()
    if (checkIfUsernameExists != '') {
      return res.json({error: 'Username already exists'}).status(422)
    }
    if (checkIfEmailExists != '') {
      return res.json({error: 'Email already taken by another account'}).status(422)
    }

    const hashedPassword = await bcrypt.hash(req.body.password, 10)
    const confirmationToken = randomstring.generate({
      length: 30,
      charset: 'alphanumeric'
    })
    const user = new User({
      username: req.body.username,
      password: hashedPassword,
      unconfirmedEmail: req.body.email,
      confirmationToken: confirmationToken,
      confirmationSentAt: Date.now()
    })
    const newUser = await user.save()

    const confirmationLink = `https://api-group3-chat-app.herokuapp.com/auth/confirmation/${newUser.id}/${confirmationToken}`
    const isSended = sendMail(req.body.email, 'eng', confirmationLink)
    if (isSended) {      
      return res.json({success: `Welcome, ${req.body.username}! Confirm your account via link sent to your email.`}).status(200)
    } else {
      userToDelete = await User.findById(newUser.id)
      await userToDelete.remove()
      return res.json({error: `Something wrong sending confirmation email. Check if given email is correct.`}).status(422)
    }       
    
  } catch(err) {
    console.log(err)
    return res.json({error: `Something wrong sending confirmation email. Check if given email is correct.`}).status(422)
  }
})


// Email Token Confirmation
router.get('/confirmation/:id/:confirmationToken', async (req, res) => {
  try {
    const confirmationToken = req.params.confirmationToken
    if (confirmationToken == '') return res.sendStatus(400)
    const userId = req.params.id
    const user = await User.findById(userId)
    if (user == null || user.confirmationToken != confirmationToken) {
      return res.sendStatus(304)
    }
    user.email = user.unconfirmedEmail
    user.unconfirmedEmail = ''
    user.confirmationToken = ''
    if (!user.confirmed) {
      user.confirmedAt = Date.now()
      user.confirmed = true
    }

    const confirmedUser = await user.save()
    return res.status(200).json({success: `Email address ${confirmedUser.email} of ${confirmedUser.username} confirmed.`})
  } catch(err) {
    return res.sendStatus(500)
  }
})

router.post('/sendPasswordResetToken',  async (req, res) => {
  try {
    const resetCode = randomstring.generate({
      length: 6,
      charset: 'numeric'
    })
    const user = await User.findOneAndUpdate({ email: req.body.email},{
      $set: {
        passwordResetCode: resetCode
      }
    }, {
      returnDocument: 'after'
    }).exec()

    const isSended = sendPasswordResetMail(req.body.email, 'eng', resetCode)
    if (isSended) {      
      return res.status(200).json({success: `Password reset code is sent to  ${req.body.email}`})
    } else {
      return res.status(422).json({error: `Something went wrong.`})
    }
    
  } catch (error) {
    console.log(error)
    return res.sendStatus(500)
  }
})

module.exports = router