//SPDX-License-Identifier: Unlicense
pragma solidity 0.7.3;

interface IYToken {
    function balanceOf(address user) external view returns (uint);
    function pricePerShare() external view returns (uint);
    function deposit(uint amount, address recipient) external returns (uint);
    function withdraw(uint shares, address recipient) external returns (uint);
    function token() external returns (address);
}