-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `openid` VARCHAR(191) NOT NULL,
    `unionid` VARCHAR(191) NULL,
    `nickname` VARCHAR(191) NULL,
    `avatar` VARCHAR(500) NULL,
    `phone` VARCHAR(191) NULL,
    `realname` VARCHAR(191) NULL,
    `status` ENUM('ACTIVE', 'SUSPENDED', 'DELETED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_openid_key`(`openid`),
    INDEX `users_unionid_idx`(`unionid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `masters` (
    `id` VARCHAR(191) NOT NULL,
    `invitedByUserId` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NOT NULL,
    `unionid` VARCHAR(191) NULL,
    `realname` VARCHAR(191) NULL,
    `realnameVerified` BOOLEAN NOT NULL DEFAULT false,
    `idNumberHash` VARCHAR(191) NULL,
    `displayName` VARCHAR(100) NOT NULL,
    `avatar` VARCHAR(500) NOT NULL,
    `intro` VARCHAR(200) NOT NULL,
    `experience` TEXT NOT NULL,
    `philosophy` TEXT NOT NULL,
    `videoUrl` VARCHAR(500) NULL,
    `methods` JSON NOT NULL,
    `topics` JSON NOT NULL,
    `badges` JSON NOT NULL,
    `status` ENUM('PENDING', 'ACTIVE', 'SUSPENDED', 'REMOVED') NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `masters_phone_key`(`phone`),
    UNIQUE INDEX `masters_unionid_key`(`unionid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `service_skus` (
    `id` VARCHAR(191) NOT NULL,
    `masterId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `type` ENUM('ASYNC_REPORT', 'REALTIME_IM') NOT NULL,
    `price` INTEGER NOT NULL,
    `durationMin` INTEGER NULL,
    `deliveryHour` INTEGER NULL,
    `description` TEXT NOT NULL,
    `status` ENUM('ACTIVE', 'DISABLED') NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `service_skus_masterId_idx`(`masterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `orders` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `masterId` VARCHAR(191) NOT NULL,
    `skuId` VARCHAR(191) NOT NULL,
    `skuSnapshot` JSON NOT NULL,
    `state` ENUM('PENDING_ACCEPT', 'ACCEPTED', 'PENDING_PAYMENT', 'PAID', 'IN_PROGRESS', 'DELIVERED', 'CONSULTATION_ENDED', 'COMPLETED', 'CANCELLED', 'REFUNDED', 'IN_DISPUTE') NOT NULL DEFAULT 'PENDING_ACCEPT',
    `scheduledAt` DATETIME(3) NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `originalPrice` INTEGER NOT NULL,
    `finalPrice` INTEGER NOT NULL,
    `platformFee` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `acceptedAt` DATETIME(3) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `orders_userId_idx`(`userId`),
    INDEX `orders_masterId_idx`(`masterId`),
    INDEX `orders_state_idx`(`state`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `price_changes` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `fromPrice` INTEGER NOT NULL,
    `toPrice` INTEGER NOT NULL,
    `reason` TEXT NOT NULL,
    `status` ENUM('PENDING', 'ACCEPTED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `decidedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `price_changes_orderId_idx`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `conversations` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `masterId` VARCHAR(191) NOT NULL,
    `unrespondedCount` INTEGER NOT NULL DEFAULT 0,
    `masterHasReplied` BOOLEAN NOT NULL DEFAULT false,
    `hasOrder` BOOLEAN NOT NULL DEFAULT false,
    `lastMessageAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `conversations_userId_idx`(`userId`),
    INDEX `conversations_masterId_idx`(`masterId`),
    UNIQUE INDEX `conversations_userId_masterId_key`(`userId`, `masterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `messages` (
    `id` VARCHAR(191) NOT NULL,
    `conversationId` VARCHAR(191) NOT NULL,
    `senderId` VARCHAR(191) NOT NULL,
    `senderType` ENUM('USER', 'MASTER', 'SYSTEM') NOT NULL,
    `type` ENUM('TEXT', 'VOICE', 'IMAGE', 'SYSTEM_CARD') NOT NULL,
    `content` TEXT NOT NULL,
    `systemCardData` JSON NULL,
    `relatedOrderId` VARCHAR(191) NULL,
    `auditStatus` ENUM('PENDING', 'PASS', 'REJECTED') NOT NULL DEFAULT 'PASS',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `messages_conversationId_idx`(`conversationId`),
    INDEX `messages_senderId_idx`(`senderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `reviews` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `masterId` VARCHAR(191) NOT NULL,
    `professional` INTEGER NOT NULL,
    `patience` INTEGER NOT NULL,
    `ritual` INTEGER NOT NULL,
    `valueForMoney` INTEGER NOT NULL,
    `tags` JSON NOT NULL,
    `content` TEXT NOT NULL,
    `images` JSON NOT NULL,
    `masterReply` TEXT NULL,
    `masterReplyAt` DATETIME(3) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `reviews_orderId_key`(`orderId`),
    INDEX `reviews_masterId_idx`(`masterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `dispute_cases` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(100) NOT NULL,
    `userStatement` TEXT NOT NULL,
    `evidence` JSON NOT NULL,
    `masterStatement` TEXT NULL,
    `ruling` ENUM('FULL_REFUND', 'PARTIAL_REFUND', 'DISMISS') NULL,
    `rulingReason` TEXT NULL,
    `resolvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `dispute_cases_orderId_key`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assets` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `ownerType` ENUM('USER', 'MASTER') NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `metadata` JSON NULL,
    `relatedOrderId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `assets_ownerId_idx`(`ownerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `schedules` (
    `id` VARCHAR(191) NOT NULL,
    `masterId` VARCHAR(191) NOT NULL,
    `dayOfWeek` INTEGER NOT NULL,
    `startTime` VARCHAR(191) NOT NULL,
    `endTime` VARCHAR(191) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `schedules_masterId_idx`(`masterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `settlements` (
    `id` VARCHAR(191) NOT NULL,
    `masterId` VARCHAR(191) NOT NULL,
    `amount` INTEGER NOT NULL,
    `type` ENUM('EARNING', 'WITHDRAW', 'REFUND_DEDUCT') NOT NULL,
    `status` ENUM('PENDING', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `relatedOrderId` VARCHAR(191) NULL,
    `withdrawTxnId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `settledAt` DATETIME(3) NULL,

    INDEX `settlements_masterId_idx`(`masterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `favorites` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `masterId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `favorites_userId_masterId_key`(`userId`, `masterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `service_skus` ADD CONSTRAINT `service_skus_masterId_fkey` FOREIGN KEY (`masterId`) REFERENCES `masters`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `messages` ADD CONSTRAINT `messages_conversationId_fkey` FOREIGN KEY (`conversationId`) REFERENCES `conversations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schedules` ADD CONSTRAINT `schedules_masterId_fkey` FOREIGN KEY (`masterId`) REFERENCES `masters`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `settlements` ADD CONSTRAINT `settlements_masterId_fkey` FOREIGN KEY (`masterId`) REFERENCES `masters`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `favorites` ADD CONSTRAINT `favorites_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
