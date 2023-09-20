import { PayoutSpeed as DomainPayoutSpeed } from "@domain/bitcoin/onchain"

import { Wallets } from "@app"

import { GT } from "@graphql/index"
import { mapError } from "@graphql/error-map"

import OnChainAddress from "@graphql/shared/types/scalar/on-chain-address"
import PayoutSpeed from "@graphql/public/types/scalar/payout-speed"
import SatAmount from "@graphql/shared/types/scalar/sat-amount"
import TargetConfirmations from "@graphql/public/types/scalar/target-confirmations"
import WalletId from "@graphql/shared/types/scalar/wallet-id"

import OnChainUsdTxFee from "@graphql/public/types/object/onchain-usd-tx-fee"

import { normalizePaymentAmount } from "../../../shared/root/mutation"

import { IbexRoutes } from "../../../../services/IbexHelper/Routes"

import { requestIBexPlugin } from "../../../../services/IbexHelper/IbexHelper"

const OnChainUsdTxFeeAsBtcDenominatedQuery = GT.Field({
  type: GT.NonNull(OnChainUsdTxFee),
  args: {
    walletId: { type: GT.NonNull(WalletId) },
    address: { type: GT.NonNull(OnChainAddress) },
    amount: { type: GT.NonNull(SatAmount) },
    speed: {
      type: PayoutSpeed,
      defaultValue: DomainPayoutSpeed.Fast,
    },
    targetConfirmations: {
      deprecationReason: "Ignored - will be replaced",
      type: TargetConfirmations,
      defaultValue: 0,
    },
  },
  resolve: async (_, args, { domainAccount }) => {
    const { walletId, address, amount, speed } = args

    for (const input of [walletId, address, amount, speed]) {
      if (input instanceof Error) throw input
    }

    const fee = await Wallets.getOnChainFeeForUsdWalletAndBtcAmount({
      walletId,
      account: domainAccount as Account,
      amount,
      address,
      speed,
    })
    
		const OnChainFee = await requestIBexPlugin(
			"GET",
			IbexRoutes.OnChainFee,
			{
				address: address,
				amount: amount
			},
			{},
		)
		console.log("OnChainFee", OnChainFee)

    if (fee instanceof Error) throw mapError(fee)

    return {
      amount: normalizePaymentAmount(fee).amount,
      targetConfirmations: 0,
    }
  },
})

export default OnChainUsdTxFeeAsBtcDenominatedQuery
