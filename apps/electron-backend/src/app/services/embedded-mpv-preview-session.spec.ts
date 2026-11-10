import {
    buildEmbeddedMpvPreviewPlan,
    clampPreviewRegion,
} from './embedded-mpv-preview-session';

describe('embedded MPV preview session plan', () => {
    it('crops the region, limits frames and plays nothing', () => {
        const plan = buildEmbeddedMpvPreviewPlan({
            region: { x: 0.1, y: 0.05, width: 0.4, height: 0.16 },
            outputWidth: 480,
        });

        expect(plan.options).toEqual(
            expect.arrayContaining(['ao=null', 'aid=no', 'mute=yes'])
        );
        expect(plan.options).toContain(
            'vf=lavfi=[crop=iw*0.4000:ih*0.1600:iw*0.1000:ih*0.0500,fps=4]'
        );
        // 0.4*16 / (0.16*9) = 4.44 → 480 / 4.44
        expect(plan.bounds).toEqual({ x: 0, y: 0, width: 480, height: 108 });
    });

    it('shows the whole frame when no region is given (region picker)', () => {
        const plan = buildEmbeddedMpvPreviewPlan({ outputWidth: 640 });

        expect(plan.region).toBeNull();
        expect(plan.options).toContain('vf=lavfi=[fps=4]');
        expect(plan.bounds).toEqual({ x: 0, y: 0, width: 640, height: 360 });
    });

    it('clamps a region that leaves the frame or is degenerate', () => {
        expect(
            clampPreviewRegion({ x: 0.9, y: 0.95, width: 0.5, height: 0.5 })
        ).toEqual({ x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
        expect(
            clampPreviewRegion({ x: 0, y: 0, width: 0, height: 0 })
        ).toEqual({ x: 0, y: 0, width: 0.02, height: 0.02 });
        expect(
            clampPreviewRegion({ x: Number.NaN, y: 0, width: 1, height: 1 })
        ).toBeNull();
    });

    it('keeps the output size inside sane limits', () => {
        const plan = buildEmbeddedMpvPreviewPlan({
            region: { x: 0, y: 0, width: 1, height: 0.02 },
            outputWidth: 99999,
        });

        expect(plan.bounds.width).toBe(960);
        expect(plan.bounds.height).toBeLessThanOrEqual(540);
        expect(plan.bounds.height).toBeGreaterThanOrEqual(24);
    });
});
