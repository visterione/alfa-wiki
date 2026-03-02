-- Fix reviews bot avatar path (file is at uploads/bot-avatars/reviews-bot.svg)
UPDATE users
SET avatar = 'uploads/bot-avatars/reviews-bot.jpg'
WHERE id = '00000000-0000-0000-0000-000000000002';
