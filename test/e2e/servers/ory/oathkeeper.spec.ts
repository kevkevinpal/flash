import { decode } from "jsonwebtoken"

import { OathkeeperUnauthorizedServiceError } from "@domain/oathkeeper/errors"
import { sendOathkeeperRequestGraphql } from "@services/oathkeeper"

import { getPhoneAndCodeFromRef } from "test/helpers"
import {
  createApolloClient,
  defaultTestClientConfig,
  killServer,
  startServer,
} from "test/e2e/helpers"
import {
  NodeIdsDocument,
  NodeIdsQuery,
  UserLoginDocument,
  UserLoginMutation,
} from "test/e2e/generated"
let serverPid: PID

beforeAll(async () => {
  serverPid = await startServer("start-main-ci")
})

afterAll(async () => {
  await killServer(serverPid)
})

// TODO: if "D" failed silently.
// should have a fail safe error fallback when therer is mismatch
// between account/user on mongoose and kratos
const userRef = "L"

describe("Oathkeeper graphql endpoints", () => {
  it("return anon if no bearer assets", async () => {
    const res = await sendOathkeeperRequestGraphql(undefined)
    if (res instanceof Error) throw res

    const decoded = decode(res, { complete: true })
    expect(decoded?.payload?.sub).toBe("anon")
  })

  it("error if an invalid token is provided", async () => {
    const res = await sendOathkeeperRequestGraphql("invalid.token" as AuthToken)
    expect(res).toBeInstanceOf(OathkeeperUnauthorizedServiceError)
  })

  it("return UserId when kratos session token is provided", async () => {
    const { phone, code } = getPhoneAndCodeFromRef(userRef)

    const { apolloClient, disposeClient } = createApolloClient(defaultTestClientConfig())

    const input = { phone, code }

    const result = await apolloClient.mutate<UserLoginMutation>({
      mutation: UserLoginDocument,
      variables: { input },
    })
    disposeClient()

    const token = result?.data?.userLogin.authToken as AuthToken
    if (!token) throw new Error("token is undefined")

    const res = await sendOathkeeperRequestGraphql(token)
    if (res instanceof Error) throw res

    const decodedNew = decode(res, { complete: true })
    const uidFromJwt = decodedNew?.payload?.sub

    expect(uidFromJwt).toHaveLength(36) // uuid-v4 token (kratosUserId)
  })
})

describe("idempotencyMiddleware", () => {
  it("ok if proper uuid is provided", async () => {
    const { apolloClient, disposeClient } = createApolloClient(defaultTestClientConfig())

    const promise = apolloClient.query<NodeIdsQuery>({
      query: NodeIdsDocument,
      context: {
        headers: {
          "X-Idempotency-Key": crypto.randomUUID(),
        },
      },
    })

    await expect(promise).resolves.toMatchObject({
      data: {
        globals: {
          __typename: "Globals",
          nodesIds: expect.arrayContaining([expect.any(String)]),
          network: "regtest",
        },
      },
    })

    disposeClient()
  })

  it("should return 400 if idempotency key is not a uuid", async () => {
    const { apolloClient, disposeClient } = createApolloClient(defaultTestClientConfig())

    const promise = apolloClient.query<NodeIdsQuery>({
      query: NodeIdsDocument,
      context: {
        headers: {
          "X-Idempotency-Key": "not-a-uuid",
        },
      },
    })

    await expect(promise).rejects.toThrow(
      "Response not successful: Received status code 400",
    )

    disposeClient()
  })

  it("second request with same idempotency key will fail", async () => {
    const key = crypto.randomUUID()

    {
      const { apolloClient, disposeClient } = createApolloClient(
        defaultTestClientConfig(),
      )

      const promise = apolloClient.query<NodeIdsQuery>({
        query: NodeIdsDocument,
        context: {
          headers: {
            "X-Idempotency-Key": key,
          },
        },
      })

      await expect(promise).resolves.toMatchObject({
        data: {
          globals: {
            __typename: "Globals",
            nodesIds: expect.arrayContaining([expect.any(String)]),
            network: "regtest",
          },
        },
      })

      disposeClient()
    }

    {
      const { apolloClient, disposeClient } = createApolloClient(
        defaultTestClientConfig(),
      )

      const promise = apolloClient.query<NodeIdsQuery>({
        query: NodeIdsDocument,
        context: {
          headers: {
            "X-Idempotency-Key": key,
          },
        },
      })

      await expect(promise).rejects.toThrow(
        "Response not successful: Received status code 409",
      )

      disposeClient()
    }
  })
})
