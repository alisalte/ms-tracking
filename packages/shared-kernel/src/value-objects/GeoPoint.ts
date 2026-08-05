/**
 * GeoPoint value object — a geographic coordinate (latitude/longitude).
 * Used by Tracking, Fleet, and Media contexts. Validates the WGS-84 bounds.
 */
import { ValueObject } from '../domain/ValueObject.js';

export interface GeoPointProps {
  readonly latitude: number;
  readonly longitude: number;
}

export class GeoPoint extends ValueObject<GeoPointProps> {
  protected constructor(props: GeoPointProps) {
    super(props);
  }

  public static of(latitude: number, longitude: number): GeoPoint {
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      throw new Error(`Invalid latitude: ${latitude} (must be -90..90)`);
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new Error(`Invalid longitude: ${longitude} (must be -180..180)`);
    }
    return new GeoPoint({ latitude, longitude });
  }

  public get latitude(): number {
    return this.props.latitude;
  }

  public get longitude(): number {
    return this.props.longitude;
  }
}
