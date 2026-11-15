import {
  PLAYER_SETTINGS,
  PlayerSettings,
} from "../../../../interface/player_settings";
import { PlayerSettingsStorage } from "./player_settings_storage";
import { parseMessage } from "@selfage/message/parser";
import {
  deserializeMessage,
  serializeMessage,
} from "@selfage/message/serializer";
import { TEST_RUNNER } from "@selfage/puppeteer_test_runner";
import { assertThat, eq } from "@selfage/test_matcher";
import { WebServiceClient } from "@selfage/web_service_client";

function normalize(
  remote?: PlayerSettings,
  local?: PlayerSettings,
): boolean | undefined {
  return PlayerSettingsStorage["normalizePlayerSettings"](remote, local)
    .displaySettings.showTimestamp;
}

TEST_RUNNER.run({
  name: "PlayerSettingsStorageShowTimestampTest",
  cases: [
    {
      name: "DefaultsToShownWhenNoSettingsExist",
      execute: () => {
        // Execute
        let showTimestamp = normalize({}, {});

        // Verify
        assertThat(showTimestamp, eq(true), "showTimestamp");
      },
    },
    {
      name: "DefaultsToShownWhenSettingsPredateTheField",
      execute: () => {
        // Execute
        let showTimestamp = normalize(
          { displaySettings: { speed: 150 } },
          { displaySettings: { showUserName: true } },
        );

        // Verify
        assertThat(showTimestamp, eq(true), "showTimestamp");
      },
    },
    {
      name: "KeepsLocalHiddenWhenRemoteLacksTheField",
      execute: () => {
        // Execute
        let showTimestamp = normalize(
          { displaySettings: { speed: 150 } },
          { displaySettings: { showTimestamp: false } },
        );

        // Verify
        assertThat(showTimestamp, eq(false), "showTimestamp");
      },
    },
    {
      name: "RemoteValueWinsOverLocal",
      execute: () => {
        // Execute
        let remoteHidden = normalize(
          { displaySettings: { showTimestamp: false } },
          { displaySettings: { showTimestamp: true } },
        );
        let remoteShown = normalize(
          { displaySettings: { showTimestamp: true } },
          { displaySettings: { showTimestamp: false } },
        );

        // Verify
        assertThat(remoteHidden, eq(false), "remote hidden");
        assertThat(remoteShown, eq(true), "remote shown");
      },
    },
    {
      name: "SaveKeepsShowTimestampLocalOnly",
      execute: async () => {
        // Prepare
        let sentRequests = new Array<any>();
        let storage = new PlayerSettingsStorage({
          send: async (request: any) => {
            sentRequests.push(request);
          },
        } as unknown as WebServiceClient);
        let previousLocal = localStorage.getItem("PlayerSettings");

        try {
          // Execute
          await storage.save({
            displaySettings: { speed: 150, showTimestamp: false },
            blockSettings: {},
          });

          // Verify
          let sentDisplaySettings =
            sentRequests[0].body.playerSettings.displaySettings;
          assertThat(sentRequests.length, eq(1), "sent requests");
          assertThat(sentDisplaySettings.speed, eq(150), "sent speed");
          assertThat(
            "showTimestamp" in sentDisplaySettings,
            eq(false),
            "sent showTimestamp",
          );
          let savedLocal = JSON.parse(localStorage.getItem("PlayerSettings"));
          assertThat(
            savedLocal.displaySettings.showTimestamp,
            eq(false),
            "local showTimestamp",
          );
        } finally {
          if (previousLocal === null) {
            localStorage.removeItem("PlayerSettings");
          } else {
            localStorage.setItem("PlayerSettings", previousLocal);
          }
        }
      },
    },
    {
      name: "SaveWithoutDisplaySettingsSendsSettingsAsIs",
      execute: async () => {
        // Prepare
        let sentRequests = new Array<any>();
        let storage = new PlayerSettingsStorage({
          send: async (request: any) => {
            sentRequests.push(request);
          },
        } as unknown as WebServiceClient);
        let previousLocal = localStorage.getItem("PlayerSettings");

        try {
          // Execute
          await storage.save({ blockSettings: {} });

          // Verify
          assertThat(
            "displaySettings" in sentRequests[0].body.playerSettings,
            eq(false),
            "sent displaySettings",
          );
        } finally {
          if (previousLocal === null) {
            localStorage.removeItem("PlayerSettings");
          } else {
            localStorage.setItem("PlayerSettings", previousLocal);
          }
        }
      },
    },
    {
      name: "MissingFieldStaysUndefinedWhenParsedFromLocalStorageJson",
      execute: () => {
        // Execute
        let parsed = parseMessage(
          JSON.parse(`{"displaySettings":{"speed":150}}`),
          PLAYER_SETTINGS,
        );

        // Verify
        assertThat(
          parsed.displaySettings.showTimestamp,
          eq(undefined),
          "showTimestamp",
        );
      },
    },
    {
      name: "MissingFieldStaysUndefinedWhenDeserializedFromBackendResponse",
      execute: () => {
        // Prepare
        let binary = serializeMessage(
          { displaySettings: { speed: 150 } },
          PLAYER_SETTINGS,
        );

        // Execute
        let deserialized = deserializeMessage(binary, PLAYER_SETTINGS);

        // Verify
        assertThat(
          deserialized.displaySettings.showTimestamp,
          eq(undefined),
          "showTimestamp",
        );
      },
    },
  ],
});
