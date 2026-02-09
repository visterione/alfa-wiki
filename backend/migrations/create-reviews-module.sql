-- =====================================================
-- REVIEWS MODULE - ALL TABLES
-- =====================================================

-- 1. REVIEW PLATFORMS (справочник площадок)
CREATE TABLE IF NOT EXISTS review_platforms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    "isActive" BOOLEAN DEFAULT TRUE,
    "sortOrder" INTEGER DEFAULT 0,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Начальные данные площадок
INSERT INTO review_platforms (name, "sortOrder") VALUES
    ('ПроДокторов', 1),
    ('Яндекс.Карты', 2),
    ('2ГИС', 3),
    ('Google Maps', 4),
    ('Zoon', 5),
    ('НаПоправку', 6),
    ('DocDoc', 7),
    ('Докту', 8)
ON CONFLICT (name) DO NOTHING;

-- 2. REVIEW BOARDS (доски = медцентры)
CREATE TABLE IF NOT EXISTS review_boards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    "ownerId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    archived BOOLEAN DEFAULT FALSE,
    "notificationSettings" JSONB DEFAULT '{
        "newReview": {"roles": ["creator"], "users": []},
        "statusChange": {"roles": ["creator", "negative_handler"], "users": []},
        "assignment": {"roles": [], "users": []}
    }',
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_review_boards_owner ON review_boards("ownerId");
CREATE INDEX IF NOT EXISTS idx_review_boards_archived ON review_boards(archived);

-- 3. REVIEW BOARD PERMISSIONS (доступ к доскам)
CREATE TABLE IF NOT EXISTS review_board_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "boardId" UUID NOT NULL REFERENCES review_boards(id) ON DELETE CASCADE,
    "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE("boardId", "userId")
);

CREATE INDEX IF NOT EXISTS idx_review_board_permissions_board ON review_board_permissions("boardId");
CREATE INDEX IF NOT EXISTS idx_review_board_permissions_user ON review_board_permissions("userId");

-- 4. REVIEW BOARD ROLES (роли на доске)
CREATE TABLE IF NOT EXISTS review_board_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "boardId" UUID NOT NULL REFERENCES review_boards(id) ON DELETE CASCADE,
    "roleName" VARCHAR(50) NOT NULL CHECK ("roleName" IN ('creator', 'negative_handler', 'reviewer', 'publisher')),
    "userId" UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE("boardId", "roleName", "userId")
);

CREATE INDEX IF NOT EXISTS idx_review_board_roles_board ON review_board_roles("boardId");
CREATE INDEX IF NOT EXISTS idx_review_board_roles_role ON review_board_roles("roleName");
CREATE INDEX IF NOT EXISTS idx_review_board_roles_user ON review_board_roles("userId");

-- 5. REVIEWS (отзывы)
CREATE TABLE IF NOT EXISTS reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "boardId" UUID NOT NULL REFERENCES review_boards(id) ON DELETE CASCADE,
    "patientName" VARCHAR(255) NOT NULL,
    "reviewDate" DATE NOT NULL,
    "platformId" UUID NOT NULL REFERENCES review_platforms(id),
    "doctorName" VARCHAR(255),
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    "reviewText" TEXT NOT NULL,
    "additionalInfo" TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'new',
    attachments JSONB DEFAULT '[]',
    "createdBy" UUID REFERENCES users(id),
    "assigneeIds" JSONB DEFAULT '[]',
    "sortOrder" INTEGER DEFAULT 0,
    archived BOOLEAN DEFAULT FALSE,
    "archivedAt" TIMESTAMP WITH TIME ZONE,
    "decisionCategory" VARCHAR(50),
    "decisionDescription" TEXT,
    "finalizedAt" TIMESTAMP WITH TIME ZONE,
    "finalizedBy" UUID REFERENCES users(id),
    "reportPdfPath" VARCHAR(1000),
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reviews_board ON reviews("boardId");
CREATE INDEX IF NOT EXISTS idx_reviews_status ON reviews(status);
CREATE INDEX IF NOT EXISTS idx_reviews_platform ON reviews("platformId");
CREATE INDEX IF NOT EXISTS idx_reviews_rating ON reviews(rating);
CREATE INDEX IF NOT EXISTS idx_reviews_doctor ON reviews("doctorName");
CREATE INDEX IF NOT EXISTS idx_reviews_date ON reviews("reviewDate");
CREATE INDEX IF NOT EXISTS idx_reviews_archived ON reviews(archived);
CREATE INDEX IF NOT EXISTS idx_reviews_sort ON reviews("sortOrder");
CREATE INDEX IF NOT EXISTS idx_reviews_created_by ON reviews("createdBy");

-- 6. REVIEW HISTORY (история действий)
CREATE TABLE IF NOT EXISTS review_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "reviewId" UUID NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    "userId" UUID NOT NULL REFERENCES users(id),
    action VARCHAR(50) NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    comment TEXT,
    attachments JSONB DEFAULT '[]',
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_review_history_review ON review_history("reviewId");
CREATE INDEX IF NOT EXISTS idx_review_history_user ON review_history("userId");
CREATE INDEX IF NOT EXISTS idx_review_history_action ON review_history(action);
CREATE INDEX IF NOT EXISTS idx_review_history_created ON review_history("createdAt");

-- Add reviews admin access to users table
DO $$
BEGIN
    -- Check if adminAccess column exists and update default
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'adminAccess'
    ) THEN
        -- Update existing users to have reviews: false in adminAccess
        UPDATE users
        SET "adminAccess" = "adminAccess" || '{"reviews": false}'::jsonb
        WHERE "adminAccess" IS NOT NULL
        AND NOT ("adminAccess" ? 'reviews');
    END IF;
END $$;
