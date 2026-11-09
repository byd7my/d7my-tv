import { Injector, runInInjectionContext, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { bindCursorHiding } from './controls-cursor';

describe('bindCursorHiding', () => {
    it('hides the cursor while asked to and restores the previous one', () => {
        const surface = document.createElement('div');
        surface.style.cursor = 'pointer';
        const hidden = signal(false);
        runInInjectionContext(TestBed.inject(Injector), () =>
            bindCursorHiding(() => surface, hidden)
        );
        TestBed.tick();
        expect(surface.style.cursor).toBe('pointer');
        hidden.set(true);
        TestBed.tick();
        expect(surface.style.cursor).toBe('none');
        hidden.set(false);
        TestBed.tick();
        expect(surface.style.cursor).toBe('pointer');
    });

    it('does nothing without a surface', () => {
        runInInjectionContext(TestBed.inject(Injector), () =>
            bindCursorHiding(() => null, () => true)
        );
        expect(() => TestBed.tick()).not.toThrow();
    });
});
