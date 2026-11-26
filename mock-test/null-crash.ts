// Intentional bug: dereferencing undefined nested property
interface UserProfile {
  id: string;
  billing?: {
    plan: string;
  };
}

function getUserPlan(user: UserProfile | undefined): string {
  // @ts-expect-error intentional runtime crash for avilog testing
  return user.billing.plan.toUpperCase();
}

function handleRequest(userId: string) {
  const fakeDb: Record<string, UserProfile> = {
    "u-1": { id: "u-1", billing: { plan: "pro" } }
  };
  const user = fakeDb[userId];
  return getUserPlan(user);
}

console.log("Starting billing check for user u-404...");
console.log(handleRequest("u-404"));
