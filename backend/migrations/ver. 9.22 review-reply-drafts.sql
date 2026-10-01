-- Что стало с черновиками ответов на отзывы (ver. 9.22).
--
-- До 9.22 черновики жили в reviews."syncMeta".drafts только до ответа и
-- стирались в момент отправки. Поэтому нигде не оставалось главного: какие
-- варианты модель предлагала и что человек в итоге отправил. Без этой пары
-- нельзя ни измерить, становятся ли черновики лучше, ни учить модель на
-- правках людей.
--
-- Строка — одна на отзыв: в batches копятся все показанные наборы (кнопка
-- «Ещё варианты» просит новый, прежний в карточке заменяется), в replyText —
-- ответ, как он ушёл. fromDraft — доля трёхсловий ответа, взятых из самого
-- близкого варианта: около 1 — отправили почти как есть, около 0 — написали
-- своё. Ответы с высокой долей не идут в образцы для модели: иначе она
-- учится на собственных текстах, и ответы становятся всё однообразнее.
--
-- Отзывов без черновиков здесь нет: их ответы написаны людьми целиком.
CREATE TABLE IF NOT EXISTS review_reply_drafts (
  "reviewId"    UUID PRIMARY KEY REFERENCES reviews(id) ON DELETE CASCADE,
  batches       JSONB NOT NULL DEFAULT '[]'::jsonb,
  "replyText"   TEXT,
  "replySource" VARCHAR(10),
  "fromDraft"   REAL,
  "bestBatch"   INTEGER,
  "bestIndex"   INTEGER,
  "repliedAt"   TIMESTAMPTZ,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS review_reply_drafts_from_draft
  ON review_reply_drafts ("fromDraft") WHERE "fromDraft" IS NOT NULL;
