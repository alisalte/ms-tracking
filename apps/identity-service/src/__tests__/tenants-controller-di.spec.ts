import 'reflect-metadata';
import { describe, expect, it } from '@jest/globals';

import { TenantsController } from '../api/tenants/tenants.controller.js';

// Nest resolves constructor dependencies from `design:paramtypes`. A parameter
// whose class was imported with `import type` is emitted as `Function`/`Object`,
// so the controller cannot be built and the container never turns healthy.
describe('TenantsController DI metadata', () => {
  it('has a real class token for every constructor dependency', () => {
    const types = Reflect.getMetadata('design:paramtypes', TenantsController) as unknown[];
    expect(types.length).toBeGreaterThan(0);
    for (const type of types) {
      expect(type).not.toBe(Object);
      expect(type).not.toBe(Function);
      expect(typeof type).toBe('function');
      expect((type as { name: string }).name).toMatch(/^[A-Z]/);
    }
  });
});
