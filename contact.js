const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { adminAuth } = require('../Middleware/Auth');

const Contact = require('../Models/contact');

const memoryContacts = [];
const contactLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false });

router.post('/',
  contactLimiter,
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().normalizeEmail(),
    body('message').trim().notEmpty().withMessage('Message is required')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, errors: errors.array() });
      }

      const contactData = {
        name: req.body.name,
        email: req.body.email,
        subject: req.body.subject || '',
        message: req.body.message,
        createdAt: new Date()
      };

      try {
        const savedMessage = await Contact.create(contactData);
        return res.status(201).json({
          success: true,
          message: 'Your message has been received.',
          data: savedMessage
        });
      } catch (dbError) {
        console.warn('Contact DB save failed, using fallback memory store:', dbError.message || dbError);
        const fallbackMessage = {
          id: `contact-${Date.now()}`,
          ...contactData
        };
        memoryContacts.push(fallbackMessage);
        return res.status(201).json({
          success: true,
          message: 'Your message has been received.',
          data: fallbackMessage
        });
      }
    } catch (error) {
      console.error('Contact error:', error);
      res.status(500).json({ success: false, message: 'Server error sending contact message' });
    }
  }
);

router.get('/', adminAuth, async (_req, res) => {
  try {
    const messages = await Contact.find().sort({ createdAt: -1 }).lean();
    return res.json({ success: true, data: messages });
  } catch (error) {
    return res.json({ success: true, data: memoryContacts });
  }
});

module.exports = router;