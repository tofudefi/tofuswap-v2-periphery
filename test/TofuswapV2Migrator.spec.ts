import chai, { expect } from 'chai'
import { Contract } from 'ethers'
import { AddressZero, MaxUint256 } from 'ethers/constants'
import { bigNumberify } from 'ethers/utils'
import { solidity, MockProvider, createFixtureLoader } from 'ethereum-waffle'

import { v2Fixture } from './shared/fixtures'
import { expandTo18Decimals, MINIMUM_LIQUIDITY } from './shared/utilities'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999
}

describe('TofuswapV2Migrator', () => {
  const provider = new MockProvider({
    hardfork: 'istanbul',
    mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
    gasLimit: 9999999
  })
  const [wallet] = provider.getWallets()
  const loadFixture = createFixtureLoader(provider, [wallet])

  let WTRXPartner: Contract
  let WTRXPair: Contract
  let router: Contract
  let migrator: Contract
  let WTRXExchangeV1: Contract
  beforeEach(async function() {
    const fixture = await loadFixture(v2Fixture)
    WTRXPartner = fixture.WTRXPartner
    WTRXPair = fixture.WTRXPair
    router = fixture.router01 // we used router01 for this contract
    migrator = fixture.migrator
    WTRXExchangeV1 = fixture.WTRXExchangeV1
  })

  it('migrate', async () => {
    const WTRXPartnerAmount = expandTo18Decimals(1)
    const TRXAmount = expandTo18Decimals(4)
    await WTRXPartner.approve(WTRXExchangeV1.address, MaxUint256)
    await WTRXExchangeV1.addLiquidity(bigNumberify(1), WTRXPartnerAmount, MaxUint256, {
      ...overrides,
      value: TRXAmount
    })
    await WTRXExchangeV1.approve(migrator.address, MaxUint256)
    const expectedLiquidity = expandTo18Decimals(2)
    const WTRXPairToken0 = await WTRXPair.token0()
    await expect(
      migrator.migrate(WTRXPartner.address, WTRXPartnerAmount, TRXAmount, wallet.address, MaxUint256, overrides)
    )
      .to.emit(WTRXPair, 'Transfer')
      .withArgs(AddressZero, AddressZero, MINIMUM_LIQUIDITY)
      .to.emit(WTRXPair, 'Transfer')
      .withArgs(AddressZero, wallet.address, expectedLiquidity.sub(MINIMUM_LIQUIDITY))
      .to.emit(WTRXPair, 'Sync')
      .withArgs(
        WTRXPairToken0 === WTRXPartner.address ? WTRXPartnerAmount : TRXAmount,
        WTRXPairToken0 === WTRXPartner.address ? TRXAmount : WTRXPartnerAmount
      )
      .to.emit(WTRXPair, 'Mint')
      .withArgs(
        router.address,
        WTRXPairToken0 === WTRXPartner.address ? WTRXPartnerAmount : TRXAmount,
        WTRXPairToken0 === WTRXPartner.address ? TRXAmount : WTRXPartnerAmount
      )
    expect(await WTRXPair.balanceOf(wallet.address)).to.eq(expectedLiquidity.sub(MINIMUM_LIQUIDITY))
  })
})
