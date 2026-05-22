-- AlterTable
ALTER TABLE `masters` ADD COLUMN `agreementSignedAt` DATETIME(3) NULL,
    ADD COLUMN `onboardingStep` ENUM('REGISTERED', 'INVITED', 'INFO_SUBMITTED', 'PROFILE_DRAFTED', 'SIGNED', 'LIVE') NOT NULL DEFAULT 'REGISTERED';

-- CreateTable
CREATE TABLE `invite_codes` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `note` VARCHAR(200) NULL,
    `status` ENUM('UNUSED', 'USED', 'REVOKED') NOT NULL DEFAULT 'UNUSED',
    `usedByMasterId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `usedAt` DATETIME(3) NULL,

    UNIQUE INDEX `invite_codes_code_key`(`code`),
    UNIQUE INDEX `invite_codes_usedByMasterId_key`(`usedByMasterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `invite_codes` ADD CONSTRAINT `invite_codes_usedByMasterId_fkey` FOREIGN KEY (`usedByMasterId`) REFERENCES `masters`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
