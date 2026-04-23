ALTER TABLE `entitled_server` ADD `lastStatusIndicatorName` text;
ALTER TABLE `entitled_server` ADD `lastUrlChannelName` text;
ALTER TABLE `entitled_server` ADD `lastOverallState` text;
ALTER TABLE `entitled_server` ADD `lastSyncedAt` integer;
ALTER TABLE `entitled_server` ADD `lastSyncError` text;

CREATE TABLE `server_incident_message` (
	`guildId` text NOT NULL,
	`incidentId` text NOT NULL,
	`channelId` text NOT NULL,
	`messageId` text NOT NULL,
	`snapshotJson` text NOT NULL,
	`snapshotHash` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`lastSeenAt` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`guildId`, `incidentId`)
);
