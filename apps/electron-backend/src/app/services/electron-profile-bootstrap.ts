import { app } from 'electron';
import { getElectronUserDataPath } from '@iptvnator/shared/database';
import { migrateRenamedProfile, selectLegacyProfile } from './legacy-profile';
import { activateSourceServerProfile } from './source-server-config';

activateSourceServerProfile();

const override = getElectronUserDataPath();
const current = override ?? app.getPath('userData');
// First start after the rename: carry the profile of the former name across.
if (!override && app.isPackaged) {
    migrateRenamedProfile(app.getPath('appData'), current);
}
const legacy = selectLegacyProfile(
    process.env.IPTVNATOR_E2E_DATA_DIR?.trim() || app.getPath('appData'),
    current
);
if (legacy || override) app.setPath('userData', legacy ?? current);
