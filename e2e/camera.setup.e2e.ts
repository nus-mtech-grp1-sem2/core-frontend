import { test as setup } from '@playwright/test';

import { FAKE_CAMERA_VIDEO, writeQrVideo } from './support/camera';

setup('generate the fake camera video', () => {
  writeQrVideo(FAKE_CAMERA_VIDEO);
});
