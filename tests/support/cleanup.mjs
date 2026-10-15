// Keep every owned release in one hook: a failing stage must not skip the rest.
export async function releaseAll(...releases) {
  const errors = [];
  for (const release of releases) {
    try {
      await release();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "Fixture cleanup failed");
}
