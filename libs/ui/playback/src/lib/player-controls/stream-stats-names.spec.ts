import { codecLabel, containerLabel, qualityLabel } from './stream-stats-names';

describe('stream stats names', () => {
    it('spells codec ids the way people know them', () => {
        expect(codecLabel('hevc')).toBe('H.265 (HEVC)');
        expect(codecLabel('avc1.640028')).toBe('H.264 (AVC)');
        expect(codecLabel('mp4a.40.2')).toBe('AAC');
        expect(codecLabel('eac3')).toBe('Dolby Digital Plus (E-AC-3)');
    });

    it('shows an unknown codec as the engine wrote it, and a blank one not at all', () => {
        expect(codecLabel('wmv3')).toBe('wmv3');
        expect(codecLabel('   ')).toBeNull();
        expect(codecLabel(null)).toBeNull();
    });

    it('names containers and passes unknown ones through', () => {
        expect(containerLabel('mpegts')).toBe('MPEG-TS');
        expect(containerLabel('mov,mp4,m4a,3gp,3g2,mj2')).toBe('MP4');
        expect(containerLabel('nut')).toBe('nut');
        expect(containerLabel(null)).toBeNull();
    });

    it.each([
        [3840, 2160, '4K'],
        [2560, 1440, 'QHD'],
        [1920, 1080, 'Full HD'],
        [1920, 800, 'Full HD'],
        [1440, 1080, 'Full HD'],
        [1280, 720, 'HD'],
        [960, 540, 'SD'],
        [720, 576, 'SD'],
    ])('calls %ix%i %s', (width, height, label) => {
        expect(qualityLabel(width, height)).toBe(label);
    });

    it('gives no quality name for an unknown size', () => {
        expect(qualityLabel(null, 1080)).toBeNull();
        expect(qualityLabel(1920, 0)).toBeNull();
    });
});
