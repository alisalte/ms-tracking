# Bug: four-corner polygon reported as self-intersecting

Clicking four corners of a rectangle in row order (bottom-left, bottom-right, top-left, top-right) draws a bow-tie. The UI paints it red and shows «اضلاع همدیگر را قطع کرده‌اند». Operators read the red fill as a color they need to pick; there is no geofence color field.

Fix: `untangleRing()` reorders vertices around the centroid whenever the ring would self-intersect, which turns a 4-point Z into a simple quad.
