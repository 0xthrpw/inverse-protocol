const hre = require('hardhat')
const { describe, it, beforeEach } = require('mocha')
const { ethers } = require('hardhat')
const { expect } = require('chai')

const INVERSE_DEPLOYER = '0x3FcB35a1CbFB6007f9BC638D388958Bc4550cB28'
const FTOKEN = '0xab7fa2b2985bccfc13c6d86b1d5a17486ab1e04c'
const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f'

const HARVESTER = '0x7F058B17648a257ADD341aB76FeBC21794c6e118'
const YFI_ADDRESS = '0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e'
const DAI_BAGS = '0x079667f4f7a0B440Ad35ebd780eFd216751f0758'

const INVDAO_TIMELOCK = '0xD93AC1B3D1a465e1D5ef841c141C8090f2716A16'
const FARMPOOL = '0x15d3A64B2d5ab9E152F16593Cdebc4bB165B5B4A'

const overrides = { gasPrice: ethers.utils.parseUnits('0', 'gwei') }

describe('harvest finance setup', () => {
  let vault, strat

  it('Should deploy DAI -> YFI Vault', async () => {
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [INVERSE_DEPLOYER]
    })
    const signer = await ethers.provider.getSigner(INVERSE_DEPLOYER)
    const Vault = (await ethers.getContractFactory('Vault')).connect(signer)
    vault = await Vault.deploy(DAI, YFI_ADDRESS, HARVESTER, 'HARVESTFI: DAI to YFI Vault', 'testDAI>ETH')
    await vault.deployed()
  })

  it('Should deploy fToken strat and connect to Vault', async () => {
    const signer = await ethers.provider.getSigner(INVERSE_DEPLOYER)
    const Strat = (await ethers.getContractFactory('FTokenStrat')).connect(signer)
    strat = await Strat.deploy(vault.address, FTOKEN, FARMPOOL, overrides)

    await strat.deployed()
    await vault.setStrat(strat.address, false)
    expect(await vault.strat()).to.equal(strat.address)
    expect(await vault.paused()).to.equal(false)
  })
})

describe('harvest finance strategy experiments', () => {
  let vault, strat

  beforeEach(async () => {
    const signer = await ethers.provider.getSigner(INVERSE_DEPLOYER)

    const Vault = (await ethers.getContractFactory('Vault')).connect(signer)
    vault = await Vault.deploy(DAI, YFI_ADDRESS, HARVESTER, 'HARVESTFI: DAI to YFI Vault', 'testDAI>ETH')
    await vault.deployed()

    const Strat = (await ethers.getContractFactory('FTokenStrat')).connect(signer)
    strat = await Strat.deploy(vault.address, FTOKEN, FARMPOOL, overrides)
    await strat.deployed()
    await vault.setStrat(strat.address, false)
  })

  it('Should should set strategist and set buffer', async function () {
    await strat.setStrategist(INVERSE_DEPLOYER)
    await strat.setBuffer(ethers.utils.parseEther('5000'))

    expect(await strat.buffer()).to.equal(ethers.utils.parseEther('5000'))
    expect(await strat.strategist()).to.equal(INVERSE_DEPLOYER)
  })

  it('Should deposit (DAI)', async () => {
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [DAI_BAGS]
    })
    const amount = ethers.utils.parseEther('1000')
    const signer = await ethers.provider.getSigner(DAI_BAGS)
    const dai = (await ethers.getContractAt('IERC20', DAI)).connect(signer)
    const signedVault = vault.connect(signer)

    await dai.approve(signedVault.address, amount)
    await signedVault.deposit(amount)
    expect(await signedVault.balanceOf(await signer.getAddress())).to.equal(amount)
  })

  it('Should deposit then withdraw (DAI)', async () => {
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [DAI_BAGS]
    })
    await strat.setStrategist(INVERSE_DEPLOYER)
    await strat.setBuffer(ethers.utils.parseEther('5000'))

    const signer = await ethers.provider.getSigner(DAI_BAGS)
    const dai = (await ethers.getContractAt('IERC20', DAI)).connect(signer)
    const signedVault = vault.connect(signer)

    await dai.approve(signedVault.address, ethers.utils.parseEther('11000000'))
    await signedVault.deposit(ethers.utils.parseEther('20000'))

    const oldBalance = await dai.balanceOf(DAI_BAGS)
    await signedVault.withdraw(ethers.utils.parseEther('1000'))
    const newBalance = await dai.balanceOf(DAI_BAGS)
    expect(newBalance.sub(oldBalance)).to.equal(ethers.utils.parseEther('1000'))
  })

  it('Should only update timelock from timelock', async () => {
    const TIMELOCK_THRESHOLD = 178800 // ~2 days to satifiy timelock
    const signer = await ethers.provider.getSigner(INVERSE_DEPLOYER)
    const attempt = strat.connect(signer)

    await expect(
      attempt.changeTimelock(INVDAO_TIMELOCK)
    ).to.be.revertedWith('CAN ONLY BE CALLED BY TIMELOCK')

    const timelockAddress = await strat.timelock()
    const timelock = await ethers.getContractAt('contracts/Timelock.sol:Timelock', timelockAddress)
    const admin = timelock.connect(signer)

    const currentBlock = await ethers.provider.getBlockNumber()
    const block = await ethers.provider.getBlock(currentBlock)

    const timestamp = block.timestamp + TIMELOCK_THRESHOLD
    const payload = ethers.utils.hexZeroPad(INVDAO_TIMELOCK, 32)
    const stratAddress = await vault.strat()

    await admin.queueTransaction(stratAddress, 0, 'changeTimelock(address)', payload, timestamp)

    const future = timestamp + 1000
    await hre.network.provider.request({
      method: 'evm_setNextBlockTimestamp',
      params: [future]
    })

    await admin.executeTransaction(stratAddress, 0, 'changeTimelock(address)', payload, timestamp)
    expect(await strat.timelock()).to.equal(INVDAO_TIMELOCK)
  })

  it('Should deposit DAI and check vaults total supply', async () => {
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [DAI_BAGS]
    })

    const amount = ethers.utils.parseEther('1000')
    const signer = await ethers.provider.getSigner(DAI_BAGS)
    const signedVault = vault.connect(signer)
    const dai = (await ethers.getContractAt('IERC20', DAI)).connect(signer)

    await dai.approve(signedVault.address, amount)
    await signedVault.deposit(amount)

    const totalSupply = (await signedVault.totalSupply()).toString()
    expect(totalSupply).to.equal(amount)
  })

  it('Should check vaults invest can only be called by onlyVault', async () => {
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [DAI_BAGS]
    })
    const signer = await ethers.provider.getSigner(DAI_BAGS)
    const attempt = strat.connect(signer)

    await expect(
      attempt.invest()
    ).to.be.revertedWith('CAN ONLY BE CALLED BY VAULT')
  })

  it('Should check vaults invest', async () => {
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [INVERSE_DEPLOYER]
    })
    const MAX_UINT = '115792089237316195423570985008687907853269984665640564039457584007913129639935'

    const stratSigner = await ethers.provider.getSigner(INVERSE_DEPLOYER)
    const stratAccess = strat.connect(stratSigner)
    const oldBuffer = await stratAccess.buffer()
    expect(oldBuffer.toString()).to.equal(MAX_UINT)
    await stratAccess.setBuffer(0, overrides)
    const newBuffer = await stratAccess.buffer()
    expect(newBuffer.toString()).to.equal('0')
  })

  it('Should check vaults invest', async () => {
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [DAI_BAGS]
    })
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [vault.address]
    })
    await hre.network.provider.request({
      method: 'hardhat_impersonateAccount',
      params: [INVERSE_DEPLOYER]
    })

    const amount = ethers.utils.parseEther('1')
    const signer = await ethers.provider.getSigner(DAI_BAGS)
    const dai = (await ethers.getContractAt('IERC20', DAI)).connect(signer)
    const signedVault = vault.connect(signer)

    await dai.approve(signedVault.address, amount)
    await signedVault.deposit(amount)

    const vaultSigner = await ethers.provider.getSigner(vault.address)
    const vaultAccess = strat.connect(vaultSigner)

    const stratSigner = await ethers.provider.getSigner(INVERSE_DEPLOYER)
    const stratAccess = strat.connect(stratSigner)

    // Note: Only initially, the buffer will keep incoming deposits in the strategy
    // instead of directly depositing them into Harvest. This way we can do it manually and
    // gradually to avoid a total collapse in the case of a bug during migration.
    // Thus at the moment, we remove the buffer by setting to 0
    await stratAccess.setBuffer(0, overrides)
    await vaultAccess.invest(overrides)
  })

  it('Should should yield FARM tokens', async () => {
    const rewardTokenAddress = await strat.rewardtoken()
    const signer = await ethers.provider.getSigner(DAI_BAGS)
    const farm = (await ethers.getContractAt('IERC20', rewardTokenAddress)).connect(signer)
    const farmBalance = await farm.balanceOf(strat.address)
    expect(farmBalance).to.gt(0)
  })
})
