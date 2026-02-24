/**
 * Job: Автоматическая архивация отзывов со статусом «Решение принято» (final)
 * Запускается крон-задачей reviewArchiveCron.js
 */

const { Review, ReviewBoard } = require('../models');
const { Op } = require('sequelize');

async function archiveFinalReviews() {
  try {
    const reviews = await Review.findAll({
      where: {
        status: 'final',
        archived: false
      },
      include: [
        { model: ReviewBoard, as: 'board', attributes: ['id', 'name'] }
      ]
    });

    if (reviews.length === 0) {
      return { success: true, count: 0 };
    }

    const now = new Date();
    const ids = reviews.map(r => r.id);

    await Review.update(
      { archived: true, archivedAt: now },
      { where: { id: { [Op.in]: ids } } }
    );

    console.log(`[ReviewArchive] Archived ${reviews.length} review(s):`);
    reviews.forEach(r => {
      console.log(`  - [${r.board?.name || r.boardId}] ${r.patientName} (${r.id})`);
    });

    return { success: true, count: reviews.length };
  } catch (error) {
    console.error('[ReviewArchive] Error:', error);
    return { success: false, error: error.message };
  }
}

module.exports = { archiveFinalReviews };
